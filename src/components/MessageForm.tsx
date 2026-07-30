"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MessageForm({ entryId }: { entryId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/v1/entries/${entryId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setLoading(false);
    if (res.ok) {
      setBody("");
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "送信に失敗しました");
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
          placeholder="メッセージを入力..."
        />
        <button
          type="submit"
          disabled={loading || !body.trim()}
          className="self-end rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          送信
        </button>
      </div>
    </form>
  );
}
