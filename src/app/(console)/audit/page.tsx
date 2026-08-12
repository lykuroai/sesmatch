import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasPermission } from "@/server/auth/rbac";
import { prisma } from "@/server/db";
import {
  AUDIT_ACTION_LABELS,
  AUDIT_TARGET_LABELS,
  formatAuditMetadata,
} from "@/lib/audit-labels";

// 追記型監査ログの閲覧（§31）。audit.read 権限が必要。
export default async function AuditPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!hasPermission(auth.roles, "audit.read")) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold">監査</h1>
        <p className="text-sm text-slate-500">監査ログの閲覧権限がありません（audit.read）。</p>
      </div>
    );
  }
  const events = await prisma.auditEvent.findMany({
    where: { tenantCompanyId: auth.companyId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const actorIds = [...new Set(events.map((ev) => ev.actorUserId).filter((v): v is string => !!v))];
  const actors = await prisma.userAccount.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true },
  });
  const actorNames = new Map(actors.map((a) => [a.id, a.name]));

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">監査ログ</h1>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">日時</th>
              <th className="px-4 py-3">操作者</th>
              <th className="px-4 py-3">操作内容</th>
              <th className="px-4 py-3">対象</th>
              <th className="px-4 py-3">詳細</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr key={ev.id} className="border-t border-slate-100">
                <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                  {new Date(ev.createdAt).toLocaleString("ja-JP")}
                </td>
                <td className="px-4 py-3 text-xs">
                  {ev.actorUserId
                    ? actorNames.get(ev.actorUserId) ?? "（退会済みユーザー）"
                    : "システム"}
                </td>
                <td className="px-4 py-3 font-medium" title={ev.action}>
                  {AUDIT_ACTION_LABELS[ev.action] ?? ev.action}
                </td>
                <td className="px-4 py-3 text-xs">
                  {ev.targetType ? (
                    <span title={ev.targetId ?? undefined}>
                      {AUDIT_TARGET_LABELS[ev.targetType] ?? ev.targetType}
                      {ev.targetId && (
                        <span className="ml-1 text-slate-400">#{ev.targetId.slice(0, 8)}</span>
                      )}
                    </span>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {formatAuditMetadata(ev.metadata).length > 0
                    ? formatAuditMetadata(ev.metadata).map((line) => (
                        <div key={line}>{line}</div>
                      ))
                    : "-"}
                </td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  監査イベントはありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
