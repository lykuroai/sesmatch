import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasPermission } from "@/server/auth/rbac";
import { listFeesDetailed, listInvoices } from "@/server/services/billing";
import { calcTax } from "@/server/billing/fee";
import { ActionButton } from "@/components/ActionButton";

// 請求（成約手数料 §23）: 月ごとに明細（日付・タイトル・契約金額・手数料・確認用消費税）と
// 月計・請求合計を表示し、請求書の発行・PDF再ダウンロードを行う。
// 明細行の消費税は確認用。正式な税額は請求書単位で月計に対して1回だけ端数処理する
// （インボイス制度の税率ごと・請求書1枚につき1回の端数処理ルール）
export default async function BillingPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!hasPermission(auth.roles, "billing.read")) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold">成約手数料</h1>
        <p className="text-sm text-slate-500">成約手数料の閲覧権限がありません（billing.read）。</p>
      </div>
    );
  }
  const [fees, invoices] = await Promise.all([listFeesDetailed(auth), listInvoices(auth)]);
  const canManage = hasPermission(auth.roles, "billing.manage");
  const invoiceByMonth = new Map(invoices.map((inv) => [inv.month, inv]));

  // 月ごとにグループ化（新しい月が先頭）
  const months = [...new Set(fees.map((f) => f.month))].sort((a, b) => b.localeCompare(a));
  const yen = (v: number) => `${v.toLocaleString()}円`;

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">成約手数料</h1>
      <p className="mb-6 text-sm text-slate-500">
        需要側企業として負担する手数料の一覧です。料率3%・最大12稼働月・13稼働月目以降無料（§23）。
        新規企業は利用開始（承認）から30日間無料です（無料月は12稼働月の課金枠を消費しません）。
        明細の消費税は確認用で、正式な税額は請求書単位で月計に対して算出します。
      </p>

      {months.length === 0 && (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400 shadow-sm">
          手数料はありません
        </p>
      )}

      {months.map((month) => {
        const rows = fees.filter((f) => f.month === month);
        const charged = rows.filter((f) => f.status === "CHARGED");
        const monthFee = charged.reduce((a, f) => a + f.feeExTaxYen, 0);
        const monthTax = calcTax(monthFee);
        const invoice = invoiceByMonth.get(month);
        const uninvoiced = charged.some((f) => !f.invoiceId);
        return (
          <section key={month} className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">{month}</h2>
              <div className="flex items-center gap-2">
                {invoice && (
                  <>
                    <span className="text-xs text-slate-500">請求書発行済み</span>
                    <Link
                      href={`/billing/invoices/${invoice.id}`}
                      className="inline-flex items-center gap-1.5 rounded border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
                    >
                      {/* PDF書類アイコン */}
                      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.3" role="img" aria-hidden="true">
                        <path d="M4 1.5h5.5L13 5v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
                        <path d="M9.5 1.5V5H13" strokeLinejoin="round" />
                        <text x="8" y="12" textAnchor="middle" fontSize="5" fill="currentColor" stroke="none" fontWeight="bold">PDF</text>
                      </svg>
                      請求書PDF
                    </Link>
                  </>
                )}
                {canManage && uninvoiced && monthFee > 0 && (
                  <ActionButton
                    path="/api/v1/invoices"
                    body={{ month }}
                    label={invoice ? "請求書を更新" : "請求書発行"}
                  />
                )}
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1.5">日付</th>
                  <th className="py-1.5">タイトル</th>
                  <th className="py-1.5 text-right">契約金額</th>
                  <th className="py-1.5 text-right">手数料</th>
                  <th className="py-1.5 text-right">消費税（確認用）</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr
                    key={f.id}
                    className={`border-t border-slate-100 ${f.status !== "CHARGED" ? "text-slate-400" : ""}`}
                  >
                    <td className="py-1.5">{new Date(f.createdAt).toLocaleDateString("ja-JP")}</td>
                    <td className="py-1.5">
                      {f.title}
                      {f.status === "CANCELLED" && (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs">キャンセル</span>
                      )}
                      {f.status === "FREE" && (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs">無料（13稼働月目以降）</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right">{yen(f.baseAmountYen)}</td>
                    <td className="py-1.5 text-right">{yen(f.feeExTaxYen)}</td>
                    <td className="py-1.5 text-right">{yen(calcTax(f.feeExTaxYen))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-300 text-sm font-medium">
                <tr>
                  <td colSpan={3} className="py-2 text-right text-slate-500">月計金額</td>
                  <td className="py-2 text-right">{yen(monthFee)}</td>
                  <td />
                </tr>
                <tr>
                  <td colSpan={3} className="py-1 text-right text-slate-500">月計消費税</td>
                  <td className="py-1 text-right">{yen(monthTax)}</td>
                  <td />
                </tr>
                <tr>
                  <td colSpan={3} className="py-1 text-right text-slate-500">請求合計</td>
                  <td className="py-1 text-right text-base font-bold">{yen(monthFee + monthTax)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </section>
        );
      })}
    </div>
  );
}
