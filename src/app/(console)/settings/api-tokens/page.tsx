import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasPermission } from "@/server/auth/rbac";
import { listApiTokens } from "@/server/auth/api-token";
import { IssueTokenForm, RevokeTokenButton, SCOPE_LABELS } from "@/components/ApiTokenAdmin";

// APIトークン（PAT）管理（local_server_spec_v0_1.md §4.1）
// 自分のトークンの発行・失効。member.manage 権限があれば自社全員分を管理できる
export default async function ApiTokensPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const { items } = await listApiTokens(auth);
  const companyWide = hasPermission(auth.roles, "member.manage");
  const fmt = (d: Date | null) =>
    d ? new Date(d).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" }) : "—";

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">APIトークン</h1>
      <p className="mb-6 text-sm text-slate-500">
        ローカルサーバ等の外部連携がAPIを利用するためのトークンです。トークンの権限は
        スコープと発行者本人の権限の両方に含まれる操作に限定されます。
        {companyWide ? "（管理権限があるため自社の全トークンを表示しています）" : ""}
      </p>
      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-bold">トークンを発行</h2>
        <IssueTokenForm />
      </section>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">用途名</th>
              <th className="px-4 py-3">スコープ</th>
              <th className="px-4 py-3">発行者</th>
              <th className="px-4 py-3">最終使用</th>
              <th className="px-4 py-3">有効期限</th>
              <th className="px-4 py-3">状態</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  トークンはまだ発行されていません
                </td>
              </tr>
            )}
            {items.map((t) => {
              const expired = t.expiresAt && new Date(t.expiresAt) < new Date();
              return (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3">{SCOPE_LABELS[t.scope] ?? t.scope}</td>
                  <td className="px-4 py-3">{t.issuerName}</td>
                  <td className="px-4 py-3">{fmt(t.lastUsedAt)}</td>
                  <td className="px-4 py-3">{t.expiresAt ? fmt(t.expiresAt) : "無期限"}</td>
                  <td className="px-4 py-3">
                    {t.revokedAt ? (
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">失効済み</span>
                    ) : expired ? (
                      <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">期限切れ</span>
                    ) : (
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">有効</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!t.revokedAt && !expired && <RevokeTokenButton tokenId={t.id} tokenName={t.name} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
