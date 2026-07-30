"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RELATIONSHIP_TYPE_LABELS } from "@/lib/constants";

export function RelationshipForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const f = new FormData(form);
    const res = await fetch("/api/v1/relationships", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partnerName: f.get("partnerName"),
        type: f.get("type"),
        contractConfirmed: f.get("contractConfirmed") === "on",
        note: f.get("note") || undefined,
      }),
    });
    if (res.ok) {
      form.reset();
      router.refresh();
    } else {
      setError("登録に失敗しました");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 text-sm">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div>
        <label className="mb-1 block text-xs text-slate-500">相手企業名</label>
        <input name="partnerName" required className="rounded border border-slate-300 px-2 py-1.5" />
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-500">種別</label>
        <select name="type" className="rounded border border-slate-300 px-2 py-1.5">
          {Object.entries(RELATIONSHIP_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-1.5 pb-1.5">
        <input type="checkbox" name="contractConfirmed" />
        直接契約を確認済み
      </label>
      <div className="flex-1">
        <label className="mb-1 block text-xs text-slate-500">備考</label>
        <input name="note" className="w-full rounded border border-slate-300 px-2 py-1.5" />
      </div>
      <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700">
        登録
      </button>
    </form>
  );
}
