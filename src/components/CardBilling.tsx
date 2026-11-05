"use client";

// カード決済（PRO版仕様書 §4.15）: Stripe Checkout の開始と Customer Portal（カード変更・解約）への遷移。
// カード情報はこの画面で扱わない（Stripe のページで入力）。billing.manage 権限
import { useState } from "react";

export function CardBillingActions({ status, canManage, currentPlanFree, checkoutResult }: {
  status: { available: boolean; subscribed: boolean; hasCustomer: boolean; paymentFailedAt: string | null; graceUntil: string | null };
  canManage: boolean;
  currentPlanFree: boolean;
  checkoutResult: "success" | "cancel" | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!status.available) return null;

  async function go(url: string, init?: RequestInit) {
    setBusy(true);
    setError(null);
    const res = await fetch(url, init);
    const b = await res.json().catch(() => null);
    setBusy(false);
    if (res.ok && b?.url) window.location.href = b.url;
    else setError(b?.error?.message ?? "手続きを開始できませんでした");
  }
  const checkout = (cycle: "MONTHLY") => { // 年払いは 2026-11-05 廃止
    if (!window.confirm(`PRO 版（月払い 39,800円・税別）のカード決済手続きへ進みます。開始当月は無料、翌月1日から請求されます。よろしいですか？`)) return;
    void go("/api/v1/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cycle }) });
  };

  return (
    <div className="mt-3 space-y-2 text-xs">
      {checkoutResult === "success" && <p className="rounded border border-emerald-300 bg-emerald-50 p-2 text-emerald-800">カード決済のお申込を受け付けました。反映まで数十秒かかることがあります（画面を再読込してください）。</p>}
      {checkoutResult === "cancel" && <p className="rounded border border-slate-300 bg-slate-50 p-2 text-slate-600">カード決済の手続きを中止しました。</p>}
      {status.paymentFailedAt && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-red-700">
          カード決済に失敗しています。{status.graceUntil ? `${new Date(status.graceUntil).toLocaleDateString("ja-JP")} までに` : ""}お支払い方法を更新してください（期限を過ぎると基本版へ切り替わります）。
        </p>
      )}
      {error && <p className="text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {status.subscribed || status.hasCustomer ? (
          <button onClick={() => go("/api/v1/billing/portal")} disabled={!canManage || busy} className="rounded border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">
            お支払い方法の管理（カード変更・解約・領収書）
          </button>
        ) : null}
        {!status.subscribed && currentPlanFree && (
          <>
            <button onClick={() => checkout("MONTHLY")} disabled={!canManage || busy} className="rounded bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              カードで PRO 版を始める（月払い）
            </button>
          </>
        )}
      </div>
      {!canManage && <p className="text-slate-500">お申込・変更は billing.manage 権限（代表・経理）で行えます。</p>}
    </div>
  );
}
