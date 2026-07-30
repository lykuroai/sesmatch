import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasPermission } from "@/server/auth/rbac";
import { prisma } from "@/server/db";
import { listPrivacyRequests } from "@/server/services/privacy";
import { PRIVACY_STATUS_LABELS } from "@/lib/constants";
import { ActionButton } from "@/components/ActionButton";
import { PrivacyRequestForm } from "@/components/PrivacyRequestForm";

// 本人訂正・削除請求（§26）
export default async function PrivacyPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!hasPermission(auth.roles, "privacy.process")) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold">プライバシー</h1>
        <p className="text-sm text-slate-500">
          本人請求の処理権限がありません（privacy.process、個人情報管理者ロール）。
        </p>
      </div>
    );
  }
  const [requests, engineers] = await Promise.all([
    listPrivacyRequests(auth),
    prisma.engineer.findMany({
      where: { tenantCompanyId: auth.companyId, deletedAt: null },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">本人訂正・削除請求</h1>
      <p className="mb-6 text-sm text-slate-500">
        削除請求は受付時に即時非公開となり、14日以内に処理判断、承認（論理削除）の30日後に物理削除を実行できます（§26）。
      </p>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-bold">請求を受け付ける</h2>
        <PrivacyRequestForm
          engineers={engineers.map((e) => ({ id: e.id, label: `${e.code} ${e.name}` }))}
        />
      </section>

      <div className="space-y-3">
        {requests.map((r) => (
          <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {r.engineerCode} — {r.kind === "DELETION" ? "削除請求" : "訂正請求"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  受付: {new Date(r.requestedAt).toLocaleDateString("ja-JP")} ／ 判断期限:{" "}
                  {new Date(r.decisionDeadline).toLocaleDateString("ja-JP")}
                  {r.scheduledPurgeAt &&
                    ` ／ 物理削除可能日: ${new Date(r.scheduledPurgeAt).toLocaleDateString("ja-JP")}`}
                </p>
                {r.reason && <p className="mt-1 text-sm text-slate-600">{r.reason}</p>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs ${
                  r.status === "RECEIVED" ? "bg-amber-50 text-amber-700"
                    : r.status === "COMPLETED" ? "bg-slate-100 text-slate-500"
                    : r.status === "REJECTED" ? "bg-red-50 text-red-700"
                    : "bg-emerald-50 text-emerald-700"
                }`}>
                  {PRIVACY_STATUS_LABELS[r.status]}
                </span>
                {r.status === "RECEIVED" && (
                  <>
                    <ActionButton
                      path={`/api/v1/privacy/requests/${r.id}/decision`}
                      body={{ approve: true }}
                      label="承認"
                      confirmMessage="承認すると論理削除され、30日後に物理削除が可能になります。"
                    />
                    <ActionButton
                      path={`/api/v1/privacy/requests/${r.id}/decision`}
                      body={{ approve: false }}
                      label="却下"
                    />
                  </>
                )}
                {r.status === "APPROVED" && r.kind === "DELETION" && (
                  <ActionButton
                    path={`/api/v1/privacy/requests/${r.id}/purge`}
                    label="物理削除を実行"
                    confirmMessage="PIIを不可逆に除去します。よろしいですか？"
                  />
                )}
              </div>
            </div>
          </div>
        ))}
        {requests.length === 0 && <p className="text-sm text-slate-400">請求はありません</p>}
      </div>
    </div>
  );
}
