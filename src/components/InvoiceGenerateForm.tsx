"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function InvoiceGenerateForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/v1/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: f.get("month") }),
    });
    if (res.ok) router.refresh();
    else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "発行に失敗しました");
    }
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-3 text-sm">
      <div>
        <label className="mb-1 block text-xs text-slate-500">対象月</label>
        <input
          type="month"
          name="month"
          required
          defaultValue={new Date().toISOString().slice(0, 7)}
          className="rounded border border-slate-300 px-2 py-1.5"
        />
      </div>
      <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700">
        未請求手数料を集計して発行
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
