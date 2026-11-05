import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasPermission } from "@/server/auth/rbac";
import { listFeesDetailed, listInvoices } from "@/server/services/billing";
import { getOwnPlan } from "@/server/services/companies";
import { listOwnPlanInvoices } from "@/server/services/plan-billing";
import { PLAN_LABELS } from "@/server/plan/features";
import { calcTax } from "@/server/billing/fee";
import { ActionButton } from "@/components/ActionButton";
import { CardBillingActions } from "@/components/CardBilling";
import { getCardBillingStatus } from "@/server/services/card-billing";

// 請求（成約手数料 §23）: 月ごとに明細（日付・タイトル・契約金額・手数料・確認用消費税）と
// 月計・請求合計を表示し、請求書の発行・PDF再ダウンロードを行う。
// 明細行の消費税は確認用。正式な税額は請求書単位で月計に対して1回だけ端数処理する
// （インボイス制度の税率ごと・請求書1枚につき1回の端数処理ルール）
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const sp = await searchParams;
  const checkoutResult = sp.checkout === "success" ? "success" : sp.checkout === "cancel" ? "cancel" : null;
  if (!hasPermission(auth.roles, "billing.read")) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold">成約手数料</h1>
        <p className="text-sm text-stone-500">成約手数料の閲覧権限がありません（billing.read）。</p>
      </div>
    );
  }
  const [fees, invoices, plan, planInvoices, card] = await Promise.all([
    listFeesDetailed(auth),
    listInvoices(auth),
    getOwnPlan(auth),
    listOwnPlanInvoices(auth),
    getCardBillingStatus(auth.companyId),
  ]);
  const planStatusLabel: Record<string, string> = { ISSUED: "未入金", PAID: "入金済み", VOID: "取消" };
  const canManage = hasPermission(auth.roles, "billing.manage");
  const invoiceByMonth = new Map(invoices.map((inv) => [inv.month, inv]));

  // 請求金額0円の明細（新規企業30日間・13稼働月目以降の無料、キャンセル）は表示しない
  const visibleFees = fees.filter((f) => f.status === "CHARGED" && f.feeExTaxYen > 0);
  // 月ごとにグループ化（新しい月が先頭）
  const months = [...new Set(visibleFees.map((f) => f.month))].sort((a, b) => b.localeCompare(a));
  const yen = (v: number) => `${v.toLocaleString()}円`;

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">成約手数料</h1>
      <p className="mb-6 text-sm text-stone-500">
        現在、基本版は完全無料のため成約手数料は発生しません（全稼働月0円）。
        この画面には過去に請求が発生した場合の明細・請求書のみ表示されます。
      </p>

      {/* プラン・請求（PRO版仕様書 §6.1, §11） */}
      <section className="mb-6 rounded-xl border border-amber-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">プラン・請求</h2>
          <span className={`rounded px-2 py-0.5 text-xs font-bold ${plan.effectivePlan === "FREE" ? "bg-stone-100 text-stone-600" : "bg-amber-600 text-white"}`}>
            {PLAN_LABELS[plan.effectivePlan]}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-xs text-stone-500">現在のプラン</dt>
          <dd>
            {PLAN_LABELS[plan.plan]}
            {plan.plan !== "FREE" && plan.effectivePlan === "FREE" && <span className="ml-1 text-xs text-amber-600">（期限切れ）</span>}
          </dd>
          <dt className="text-xs text-stone-500">期限</dt>
          <dd>{plan.planExpiresAt ? new Date(plan.planExpiresAt).toLocaleDateString("ja-JP") : plan.plan === "FREE" ? "-" : "無期限"}</dd>
          <dt className="text-xs text-stone-500">担当者数 / 席数</dt>
          <dd>
            {plan.activeMembers} / {plan.planSeats}名
            {plan.plan === "PRO" && plan.activeMembers > plan.planSeats && (
              <span className="ml-1 text-xs text-amber-600">（追加 {plan.activeMembers - plan.planSeats}名）</span>
            )}
          </dd>
          <dt className="text-xs text-stone-500">支払</dt>
          <dd>月払い / {plan.paymentMethod === "CARD" ? "カード" : "請求書払い"}</dd>
        </dl>
        {/* カード決済（PRO版仕様書 §4.15）。Stripe 未設定なら表示しない */}
        <CardBillingActions
          status={{ ...card, paymentFailedAt: card.paymentFailedAt?.toISOString() ?? null, graceUntil: card.graceUntil?.toISOString() ?? null }}
          canManage={canManage}
          currentPlanFree={plan.effectivePlan === "FREE"}
          checkoutResult={checkoutResult}
        />
        {plan.effectivePlan === "FREE" ? (
          <p className="mt-3 text-xs text-stone-500">
            PRO 版（月額 39,800円・税別）のお申込は
            <Link href="/company/plan" className="mx-1 text-orange-800 hover:underline">会社マイページ &gt; プラン</Link>
            から（2026年12月4日受付開始）。
            <Link href="/pricing" className="ml-1 text-orange-800 hover:underline">料金を見る</Link>
          </p>
        ) : (
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-bold">PRO 版の請求書</h3>
            {planInvoices.length === 0 ? (
              <p className="text-sm text-stone-400">請求書はまだありません（開始当月は無料、翌月分から月初に発行されます）</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-stone-500">
                  <tr>
                    <th className="py-1.5">対象月</th>
                    <th className="py-1.5">請求書番号</th>
                    <th className="py-1.5 text-right">金額（税込）</th>
                    <th className="py-1.5">支払期限</th>
                    <th className="py-1.5">状態</th>
                    <th className="py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {planInvoices.map((inv) => (
                    <tr key={inv.id} className="border-t border-stone-100">
                      <td className="py-1.5">{inv.month}</td>
                      <td className="py-1.5">{inv.invoiceNumber}</td>
                      <td className="py-1.5 text-right">{yen(inv.totalYen)}</td>
                      <td className="py-1.5">{new Date(inv.dueAt).toLocaleDateString("ja-JP")}</td>
                      <td className="py-1.5">
                        <span className={`rounded px-1.5 py-0.5 text-xs ${inv.status === "PAID" ? "bg-emerald-50 text-emerald-700" : inv.status === "VOID" ? "bg-stone-100 text-stone-500 line-through" : "bg-amber-50 text-amber-700"}`}>
                          {planStatusLabel[inv.status]}
                        </span>
                      </td>
                      <td className="py-1.5 text-right">
                        <Link href={`/billing/plan-invoices/${inv.id}`} className="text-orange-800 hover:underline">請求書</Link>
                        {inv.stripeHostedUrl && (
                          <a href={inv.stripeHostedUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-orange-800 hover:underline">
                            Stripe
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      {months.length === 0 && (
        <p className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-400 shadow-sm">
          手数料はありません（基本版は完全無料です）
        </p>
      )}

      {months.map((month) => {
        const rows = visibleFees.filter((f) => f.month === month);
        const monthFee = rows.reduce((a, f) => a + f.feeExTaxYen, 0);
        const monthTax = calcTax(monthFee);
        const invoice = invoiceByMonth.get(month);
        const uninvoiced = rows.some((f) => !f.invoiceId);
        return (
          <section key={month} className="mb-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">{month}</h2>
              <div className="flex items-center gap-2">
                {invoice && (
                  <>
                    <span className="text-xs text-stone-500">請求書発行済み</span>
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
              <thead className="text-left text-xs text-stone-500">
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
                  <tr key={f.id} className="border-t border-stone-100">
                    <td className="py-1.5">{new Date(f.createdAt).toLocaleDateString("ja-JP")}</td>
                    <td className="py-1.5">{f.title}</td>
                    <td className="py-1.5 text-right">{yen(f.baseAmountYen)}</td>
                    <td className="py-1.5 text-right">{yen(f.feeExTaxYen)}</td>
                    <td className="py-1.5 text-right">{yen(calcTax(f.feeExTaxYen))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-stone-300 text-sm font-medium">
                <tr>
                  <td colSpan={3} className="py-2 text-right text-stone-500">月計金額</td>
                  <td className="py-2 text-right">{yen(monthFee)}</td>
                  <td />
                </tr>
                <tr>
                  <td colSpan={3} className="py-1 text-right text-stone-500">月計消費税</td>
                  <td className="py-1 text-right">{yen(monthTax)}</td>
                  <td />
                </tr>
                <tr>
                  <td colSpan={3} className="py-1 text-right text-stone-500">請求合計</td>
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
