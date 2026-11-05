import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasPermission } from "@/server/auth/rbac";
import { getOwnPlan } from "@/server/services/companies";
import { listOwnPlanRequests } from "@/server/services/plan-requests";
import { PLAN_LABELS } from "@/server/plan/features";
import { isProSignupOpen } from "@/lib/plan-signup";
import { PlanRequestPanel } from "@/components/PlanRequestPanel";

// 会社マイページ「プラン」（2026-11-05）: 現在のプランの確認と、PRO 版の申込・解約申請。請求書は「成約手数料 > プラン・請求」
const STATUS_LABEL = { PENDING: "確認中", APPROVED: "承認", REJECTED: "却下", WITHDRAWN: "取り下げ" } as const;
const KIND_LABEL = { UPGRADE: "PRO 版の申込", CANCEL: "PRO 版の解約申請" } as const;

export default async function CompanyPlanPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!hasPermission(auth.roles, "billing.read")) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold">プラン</h1>
        <p className="text-sm text-stone-500">プランの閲覧権限がありません（billing.read）。</p>
      </div>
    );
  }
  const [plan, requests] = await Promise.all([getOwnPlan(auth), listOwnPlanRequests(auth)]);
  const pending = requests.find((r) => r.status === "PENDING") ?? null;
  const canManage = hasPermission(auth.roles, "billing.manage");
  const expiresLabel = plan.planExpiresAt ? new Date(plan.planExpiresAt).toLocaleDateString("ja-JP") : null;

  return (
    <div>
      <p className="mb-2 text-xs text-stone-500">
        <Link href="/company" className="hover:underline">会社マイページ</Link> / プラン
      </p>
      <h1 className="mb-6 text-2xl font-bold">プラン</h1>

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
          請求書は
          <Link href="/billing" className="mx-0.5 text-orange-800 hover:underline">成約手数料 &gt; プラン・請求</Link>
          で確認できます。
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
