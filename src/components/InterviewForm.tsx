"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function InterviewForm({ entryId }: { entryId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const res = await fetch(`/api/v1/entries/${entryId}/interviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scheduledAt: new Date(String(f.get("scheduledAt"))).toISOString(),
        method: f.get("method"),
        note: f.get("note") || undefined,
      }),
    });
    setLoading(false);
    if (res.ok) {
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "登録に失敗しました");
    }
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-3 text-sm">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div>
        <label className="mb-1 block text-xs text-slate-500">日時</label>
        <input type="datetime-local" name="scheduledAt" required className="rounded border border-slate-300 px-2 py-1.5" />
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-500">方法</label>
        <select name="method" className="rounded border border-slate-300 px-2 py-1.5">
          <option>オンライン</option>
          <option>対面</option>
        </select>
      </div>
      <div className="flex-1">
        <label className="mb-1 block text-xs text-slate-500">メモ</label>
        <input name="note" className="w-full rounded border border-slate-300 px-2 py-1.5" />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="rounded bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        面談を設定
      </button>
    </form>
  );
}
