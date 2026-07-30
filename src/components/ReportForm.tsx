"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { REPORT_CATEGORIES } from "@/lib/constants";

export function ReportForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const f = new FormData(form);
    const res = await fetch("/api/v1/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: f.get("category"),
        targetRef: f.get("targetRef") || undefined,
        body: f.get("body"),
      }),
    });
    if (res.ok) {
      form.reset();
      router.refresh();
    } else {
      setError("送信に失敗しました");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-sm">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-3">
        <div>
          <label className="mb-1 block text-xs text-slate-500">区分</label>
          <select name="category" className="rounded border border-slate-300 px-2 py-1.5">
            {REPORT_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs text-slate-500">対象（エントリーID・企業名等、任意）</label>
          <input name="targetRef" className="w-full rounded border border-slate-300 px-2 py-1.5" />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-500">内容</label>
        <textarea name="body" rows={3} required className="w-full rounded border border-slate-300 px-2 py-1.5" />
      </div>
      <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700">
        通報を送信
      </button>
    </form>
  );
}
