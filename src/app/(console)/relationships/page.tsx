import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasPermission } from "@/server/auth/rbac";
import { prisma } from "@/server/db";
import { RELATIONSHIP_TYPE_LABELS } from "@/lib/constants";
import { RelationshipForm } from "@/components/RelationshipForm";

// 企業間関係: 取引先・一社下・営業委任（§8.2, §12.4）
export default async function RelationshipsPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const canManage = hasPermission(auth.roles, "relationship.manage");
  const items = await prisma.companyRelationship.findMany({
    where: { companyId: auth.companyId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">企業間関係</h1>
      <p className="mb-6 text-sm text-slate-500">
        一社下人材を提案するには、直接契約が確認済みの「一社下」関係の登録が必要です（最大商流1・二社下以降は禁止）。
      </p>
      {canManage && (
        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">関係を登録</h2>
          <RelationshipForm />
        </section>
      )}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">相手企業</th>
              <th className="px-4 py-3">種別</th>
              <th className="px-4 py-3">直接契約確認</th>
              <th className="px-4 py-3">備考</th>
              <th className="px-4 py-3">登録日</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium">{r.partnerName}</td>
                <td className="px-4 py-3">{RELATIONSHIP_TYPE_LABELS[r.type]}</td>
                <td className="px-4 py-3">
                  {r.contractConfirmed ? "✓ 確認済み" : <span className="text-amber-600">未確認</span>}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{r.note ?? "-"}</td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {new Date(r.createdAt).toLocaleDateString("ja-JP")}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  登録された企業間関係はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
