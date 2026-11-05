"use client";

// 面談の Web 会議操作（PRO版仕様書 §4.8）: 作成／再発行（PRO）・参加（両社）・本人用 URL の発行・無効化
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function MeetingControls({
  entryId,
  interviewId,
  hasMeeting,
  canCreate,
  canManage,
  guestExpiresAt,
}: {
  entryId: string;
  interviewId: string;
  hasMeeting: boolean;
  canCreate: boolean; // PRO かつ interview.manage
  canManage: boolean;
  guestExpiresAt: string | null;
}) {
  const router = useRouter();
  const [guestUrl, setGuestUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/interviews/${interviewId}/meeting`, { method: "POST" });
    setBusy(false);
    const b = await res.json().catch(() => null);
    if (res.ok) {
      setGuestUrl(b.guestUrl);
      router.refresh();
    } else setError(b?.error?.message ?? "会議室を作成できませんでした");
  }
  async function revoke() {
    if (!window.confirm("この面談の Web 会議を無効化しますか？（本人用 URL も無効になります）")) return;
    const res = await fetch(`/api/v1/interviews/${interviewId}/meeting`, { method: "DELETE" });
    if (res.ok) {
      setGuestUrl(null);
      router.refresh();
    } else setError("無効化に失敗しました");
  }
  return (
    <span className="ml-auto flex flex-wrap items-center gap-2 text-xs">
      {hasMeeting && (
        <Link href={`/entries/${entryId}/meeting/${interviewId}`} className="rounded bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-700">
          Web 会議に参加
        </Link>
      )}
      {canCreate && (
        <button type="button" onClick={create} disabled={busy} className="rounded border border-emerald-600 px-3 py-1 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
          {hasMeeting ? "本人用 URL を再発行" : "Web 会議を作成（PRO）"}
        </button>
      )}
      {hasMeeting && canManage && (
        <button type="button" onClick={revoke} className="rounded border border-stone-300 px-2 py-1 text-stone-600 hover:bg-stone-50">無効化</button>
      )}
      {guestUrl && (
        <span className="w-full rounded border border-amber-300 bg-amber-50 p-2 text-stone-700">
          人材本人用の参加 URL（面談予定の前後1時間のみ有効。本人へ転送してください。再表示はできません）:
          <code className="ml-1 break-all">{guestUrl}</code>
        </span>
      )}
      {!guestUrl && hasMeeting && guestExpiresAt && <span className="text-stone-400">本人用 URL 有効期限 {new Date(guestExpiresAt).toLocaleString("ja-JP")}</span>}
      {error && <span className="text-red-600">{error}</span>}
    </span>
  );
}
