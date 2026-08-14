"use client";

// お問合せスレッドへの追記（企業側）
import { useState } from "react";
import { useRouter } from "next/navigation";

export function InquiryReplyForm({ inquiryId }: { inquiryId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/v1/inquiries/${inquiryId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setLoading(false);
    if (res.ok) {
      setBody("");
      setOpen(false);
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "送信に失敗しました");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
      >
        返信する
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="mt-2 space-y-2">
      {error && <p className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={5000}
        required
        autoFocus
        className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
        placeholder="返信内容を入力してください"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading || !body.trim()}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "送信中..." : "送信"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
