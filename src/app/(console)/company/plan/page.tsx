import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasPermission } from "@/server/auth/rbac";
import { getOwnPlan } from "@/server/services/companies";
import { listOwnPlanRequests } from "@/server/services/plan-requests";
import { listOwnPlanInvoices } from "@/server/services/plan-billing";
import { PLAN_LABELS } from "@/server/plan/features";
import { isProSignupOpen } from "@/lib/plan-signup";
import { PlanRequestPanel } from "@/components/PlanRequestPanel";

// 会社マイページ「プラン・請求」（2026-11-05）: 現在のプランの確認、PRO 版の申込・解約申請、PRO 版の請求書の一覧
// （「成約手数料」画面の廃止に伴い請求書の一覧をここへ移した。2026-11-05 郭指示）
const STATUS_LABEL = { PENDING: "確認中", APPROVED: "承認", REJECTED: "却下", WITHDRAWN: "取り下げ" } as const;
const KIND_LABEL = { UPGRADE: "PRO 版の申込", CANCEL: "PRO 版の解約申請" } as const;
const INVOICE_STATUS_LABEL: Record<string, string> = { ISSUED: "未入金", PAID: "入金済み", VOID: "取消" };

export default async function CompanyPlanPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!hasPermission(auth.roles, "billing.read")) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold">プラン・請求</h1>
        <p className="text-sm text-stone-500">プラン・請求の閲覧権限がありません（billing.read）。</p>
      </div>
    );
  }
  const [plan, requests, invoices] = await Promise.all([getOwnPlan(auth), listOwnPlanRequests(auth), listOwnPlanInvoices(auth)]);
  const pending = requests.find((r) => r.status === "PENDING") ?? null;
  const canManage = hasPermission(auth.roles, "billing.manage");
  const expiresLabel = plan.planExpiresAt ? new Date(plan.planExpiresAt).toLocaleDateString("ja-JP") : null;

  return (
    <div>
      <p className="mb-2 text-xs text-stone-500">
        <Link href="/company" className="hover:underline">会社マイページ</Link> / プラン・請求
      </p>
      <h1 className="mb-6 text-2xl font-bold">プラン・請求</h1>

      <section className="mb-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">現在のプラン</h2>
          <span className={`rounded px-2 py-0.5 text-xs font-bold ${plan.effectivePlan === "FREE" ? "bg-stone-100 text-stone-600" : "bg-amber-600 text-white"}`}>
            {PLAN_LABELS[plan.effectivePlan]}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-xs text-stone-500">プラン</dt>
          <dd>
            {PLAN_LABELS[plan.plan]}
            {plan.plan !== "FREE" && plan.effectivePlan === "FREE" && <span className="ml-1 text-xs text-amber-600">（期限切れ）</span>}
          </dd>
          <dt className="text-xs text-stone-500">期限</dt>
          <dd>{expiresLabel ?? (plan.plan === "FREE" ? "-" : "無期限")}</dd>
          <dt className="text-xs text-stone-500">担当者数 / 席数</dt>
          <dd>
            {plan.activeMembers} / {plan.planSeats}名
            {plan.effectivePlan === "PRO" && plan.activeMembers > plan.planSeats && (
              <span className="ml-1 text-xs text-amber-600">（追加 {plan.activeMembers - plan.planSeats}名）</span>
            )}
          </dd>
          <dt className="text-xs text-stone-500">支払</dt>
          <dd>{plan.effectivePlan === "FREE" ? "-" : plan.paymentMethod === "CARD" ? "カード" : "請求書払い（月払い）"}</dd>
        </dl>
        <p className="mt-3 text-xs text-stone-500">
          PRO 版は月額 39,800円（税別・担当者5名まで含む、6名以降は1名 4,000円/月）。利用開始当月は無料で、翌月分から月初に請求書を発行します（月末締め・翌月末振込、日割りなし）。
          請求書はこの画面の「PRO 版の請求書」で確認・印刷できます。
          <Link href="/pricing" target="_blank" className="ml-1 text-orange-800 hover:underline">料金・機能比較</Link>
        </p>
        <PlanRequestPanel
          canManage={canManage}
          proSignupOpen={isProSignupOpen()}
          effectivePlan={plan.effectivePlan}
          hasExpiry={!!plan.planExpiresAt}
          pendingRequest={pending ? { id: pending.id, kind: pending.kind, createdAt: pending.createdAt.toISOString() } : null}
        />
      </section>

      {/* PRO 版の請求書（PRO版仕様書 §6.1, §11）。基本版で請求書が無ければ出さない */}
      {(plan.effectivePlan !== "FREE" || invoices.length > 0) && (
        <section className="mb-6 rounded-xl border border-amber-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">PRO 版の請求書</h2>
          {invoices.length === 0 ? (
            <p className="text-sm text-stone-400">請求書はまだありません（利用開始当月は無料、翌月分から月初に発行されます）</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs text-stone-500">
                <tr>
                  <th className="px-3 py-2">対象月</th>
                  <th className="px-3 py-2">請求書番号</th>
                  <th className="px-3 py-2 text-right">金額（税込）</th>
                  <th className="px-3 py-2">支払期限</th>
                  <th className="px-3 py-2">状態</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-t border-stone-100">
                    <td className="px-3 py-2">{inv.month}</td>
                    <td className="px-3 py-2">{inv.invoiceNumber}</td>
                    <td className="px-3 py-2 text-right">{inv.totalYen.toLocaleString()}円</td>
                    <td className="px-3 py-2">{new Date(inv.dueAt).toLocaleDateString("ja-JP")}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${inv.status === "PAID" ? "bg-emerald-50 text-emerald-700" : inv.status === "VOID" ? "bg-stone-100 text-stone-500 line-through" : "bg-amber-50 text-amber-700"}`}>
                        {INVOICE_STATUS_LABEL[inv.status] ?? inv.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link href={`/billing/plan-invoices/${inv.id}`} className="text-orange-800 hover:underline">請求書</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {requests.length > 0 && (
        <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">申請履歴</h2>
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2">申請日</th>
                <th className="px-3 py-2">種別</th>
                <th className="px-3 py-2">状態</th>
                <th className="px-3 py-2">運営からの連絡</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-t border-stone-100">
                  <td className="px-3 py-2 text-xs">{r.createdAt.toLocaleDateString("ja-JP")}</td>
                  <td className="px-3 py-2">{KIND_LABEL[r.kind]}</td>
                  <td className="px-3 py-2 text-xs">{STATUS_LABEL[r.status]}</td>
                  <td className="px-3 py-2 text-xs text-stone-600">{r.status === "REJECTED" ? r.processedNote : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
