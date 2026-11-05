"use client";

// 面談の変更（日時・方法・メモ。2026-11-06 郭指示）。予定中の面談の行に「編集」を出し、その場で修正して PUT /interviews/:id を呼ぶ。
// 方法を Web 会議（組込み）へ変えた場合（PRO）は会議室が作られ、本人用 URL をこの場で一度だけ表示する
import { useState } from "react";
import { useRouter } from "next/navigation";

const WEB_MEETING = "Web会議（組込み）";

// ISO 日時をブラウザのローカル時刻で datetime-local の値（YYYY-MM-DDTHH:mm）にする
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function InterviewEditForm({
  interviewId,
  scheduledAt,
  method,
  note,
  webMeeting,
}: {
  interviewId: string;
  scheduledAt: string; // ISO
  method: string;
  note: string | null;
  webMeeting: boolean; // PRO かつ基盤あり（Web 会議（組込み）を選べる）
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guestUrl, setGuestUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const res = await fetch(`/api/v1/interviews/${interviewId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scheduledAt: new Date(String(f.get("scheduledAt"))).toISOString(),
        method: f.get("method"),
        note: String(f.get("note") ?? "").trim() || null,
      }),
    });
    setLoading(false);
    const b = await res.json().catch(() => null);
    if (res.ok) {
      if (b?.meetingError) setError(`面談は変更しましたが、Web 会議を作成できませんでした: ${b.meetingError}`);
      if (b?.meeting?.guestUrl) setGuestUrl(b.meeting.guestUrl);
      else setOpen(false);
      router.refresh();
    } else {
      setError(b?.error?.message ?? "変更に失敗しました");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50"
      >
        編集
      </button>
    );
  }
  const methods = [...(webMeeting || method === WEB_MEETING ? [WEB_MEETING] : []), "オンライン", "対面"];
  if (!methods.includes(method)) methods.push(method);
  return (
    <form onSubmit={submit} className="flex w-full flex-wrap items-end gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">
      <div>
        <label className="mb-1 block text-xs text-stone-500">日時</label>
        <input type="datetime-local" name="scheduledAt" required defaultValue={toLocalInput(scheduledAt)} className="rounded border border-stone-300 px-2 py-1.5" />
      </div>
      <div>
        <label className="mb-1 block text-xs text-stone-500">方法</label>
        <select name="method" defaultValue={method} className="rounded border border-stone-300 px-2 py-1.5">
          {methods.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </div>
      <div className="min-w-[12rem] flex-1">
        <label className="mb-1 block text-xs text-stone-500">メモ</label>
        <input name="note" defaultValue={note ?? ""} className="w-full rounded border border-stone-300 px-2 py-1.5" />
      </div>
      <button type="submit" disabled={loading} className="rounded bg-orange-700 px-3 py-1.5 font-medium text-white hover:bg-orange-800 disabled:opacity-50">
        変更を保存
      </button>
      <button type="button" onClick={() => { setOpen(false); setGuestUrl(null); setError(null); }} className="rounded border border-stone-300 px-3 py-1.5 text-stone-600 hover:bg-white">
        {guestUrl ? "閉じる" : "取消"}
      </button>
      {method === WEB_MEETING && (
        <p className="w-full text-xs text-stone-500">
          日時を変えても Web 会議の会議室と本人用 URL はそのまま使え、有効時間は新しい日時の前後1時間になります。方法を Web 会議以外に変えると会議室は無効化されます。
        </p>
      )}
      {guestUrl && (
        <p className="w-full rounded border border-amber-300 bg-amber-50 p-2 text-xs text-stone-700">
          人材本人用の参加 URL（面談予定の前後1時間のみ有効。本人へ転送してください。再表示はできません）:
          <code className="ml-1 break-all">{guestUrl}</code>
        </p>
      )}
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </form>
  );
}
