"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PrivacyRequestForm({
  engineers,
}: {
  engineers: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const f = new FormData(form);
    const res = await fetch("/api/v1/privacy/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engineerId: f.get("engineerId"),
        kind: f.get("kind"),
        reason: f.get("reason") || undefined,
      }),
    });
    if (res.ok) {
      form.reset();
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "受付に失敗しました");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 text-sm">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div>
        <label className="mb-1 block text-xs text-slate-500">対象人材</label>
        <select name="engineerId" required className="min-w-56 rounded border border-slate-300 px-2 py-1.5">
          <option value="">選択してください</option>
          {engineers.map((e) => (
            <option key={e.id} value={e.id}>{e.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-500">種別</label>
        <select name="kind" className="rounded border border-slate-300 px-2 py-1.5">
          <option value="DELETION">削除請求</option>
          <option value="CORRECTION">訂正請求</option>
        </select>
      </div>
      <div className="flex-1">
        <label className="mb-1 block text-xs text-slate-500">理由・内容（任意）</label>
        <input name="reason" className="w-full rounded border border-slate-300 px-2 py-1.5" />
      </div>
      <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700">
        受付
      </button>
    </form>
  );
}
