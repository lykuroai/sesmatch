"use client";

// 会社マイページ「プラン」: PRO 版の申込・解約申請（2026-11-05）。申込だけではプランは変わらず、運営の承認で有効化・期限設定される
import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  canManage: boolean;
  proSignupOpen: boolean;
  effectivePlan: "FREE" | "TRIAL" | "PRO";
  hasExpiry: boolean;
  pendingRequest: { id: string; kind: "UPGRADE" | "CANCEL"; createdAt: string } | null;
};

export function PlanRequestPanel({ canManage, proSignupOpen, effectivePlan, hasExpiry, pendingRequest }: Props) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function send(kind: "UPGRADE" | "CANCEL") {
    const confirmText =
      kind === "UPGRADE"
        ? "PRO 版（月額 39,800円・税別、担当者5名まで、請求書払い）を申し込みます。運営の確認後に有効化され、利用開始当月は無料、翌月分から請求書を発行します。よろしいですか？"
        : "PRO 版の解約を申請します。承認後は当月末までご利用いただけ、翌月から基本版になります（返金なし・データは保持）。よろしいですか？";
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/v1/company/plan-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, note: note || undefined }),
    });
    setBusy(false);
    if (res.ok) {
      setMessage(kind === "UPGRADE" ? "PRO 版の申込を受け付けました。運営が確認のうえメールでご案内します。" : "解約申請を受け付けました。運営が確認のうえメールでご案内します。");
      setNote("");
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "送信に失敗しました");
    }
  }

  async function withdraw(id: string) {
    if (!window.confirm("この申請を取り下げますか？")) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/company/plan-requests/${id}/withdraw`, { method: "POST" });
    setBusy(false);
    if (res.ok) router.refresh();
    else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "取り下げに失敗しました");
    }
  }

  return (
    <div className="mt-4">
      {error && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {message && <p className="mb-3 rounded bg-emerald-50 p-2 text-sm text-emerald-700">{message}</p>}
      {pendingRequest ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-bold">{pendingRequest.kind === "UPGRADE" ? "PRO 版の申込" : "PRO 版の解約申請"}を運営が確認中です</p>
          <p className="mt-1 text-xs">申請日: {new Date(pendingRequest.createdAt).toLocaleString("ja-JP")}。処理結果はメールでお知らせします。</p>
          {canManage && (
            <button onClick={() => withdraw(pendingRequest.id)} disabled={busy} className="mt-2 rounded border border-amber-400 bg-white px-3 py-1 text-xs hover:bg-amber-100 disabled:opacity-50">
              申請を取り下げる
            </button>
          )}
        </div>
      ) : !canManage ? (
        <p className="text-xs text-slate-500">プランの申込・解約申請は請求管理権限（billing.manage）をもつ担当者が行えます。</p>
      ) : !proSignupOpen ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          PRO 版の申込受付は <span className="font-bold">2026年12月4日</span> からです。それまでは「お問合せ」からご相談ください。
        </p>
      ) : (
        <div>
          <label className="block text-xs text-slate-500">
            備考（任意。ご要望や連絡事項）
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {effectivePlan !== "PRO" && (
              <button onClick={() => send("UPGRADE")} disabled={busy} className="rounded bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                PRO 版を申し込む
              </button>
            )}
            {effectivePlan === "PRO" && !hasExpiry && (
              <button onClick={() => send("CANCEL")} disabled={busy} className="rounded border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
                解約を申請する（翌月から基本版）
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
