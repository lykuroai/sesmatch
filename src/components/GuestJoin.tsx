"use client";

// 人材本人のゲスト参加（PRO版仕様書 §4.8）: 表示名（既定はイニシャル任意）を入力して参加
import { useState } from "react";
import { JitsiRoom } from "./JitsiRoom";

export function GuestJoin({ token, scheduledAt, validFrom, validTo, open, available }: { token: string; scheduledAt: string; validFrom: string; validTo: string; open: boolean; available: boolean }) {
  const [name, setName] = useState("");
  const [room, setRoom] = useState<{ domain: string; room: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fmt = (s: string) => new Date(s).toLocaleString("ja-JP");
  async function join(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`/api/v1/meetings/guest/${token}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: name }) });
    const b = await res.json().catch(() => null);
    if (res.ok) setRoom(b);
    else setError(b?.error?.message ?? "参加できません");
  }
  if (room) return <div className="mt-4"><JitsiRoom domain={room.domain} room={room.room} token={room.token} onLeave={() => setRoom(null)} /></div>;
  return (
    <form onSubmit={join} className="mt-4 rounded-xl bg-white p-5 text-sm shadow-sm">
      <p>面談予定: <span className="font-medium">{fmt(scheduledAt)}</span></p>
      <p className="mt-1 text-xs text-stone-500">この URL は {fmt(validFrom)} 〜 {fmt(validTo)} の間に参加できます。</p>
      {!available && <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800">現在 Web 会議はご利用いただけません。送付元の企業にご確認ください。</p>}
      {!open && available && <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800">参加できる時間になったらこのページを開き直してください。</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <label className="mt-4 block text-xs text-stone-600">
        表示名（任意。イニシャル等で構いません）
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="例: T.K" className="mt-1 w-full max-w-xs rounded border border-stone-300 px-2 py-1.5" />
      </label>
      <button type="submit" disabled={!open || !available} className="mt-4 rounded bg-emerald-600 px-5 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
        参加する
      </button>
    </form>
  );
}
