"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 月次稼働確認（需要側）: 確定契約金額を入力して手数料を計算（§23）
export function WorkMonthForm({
  contractId,
  defaultAmountYen,
}: {
  contractId: string;
  defaultAmountYen: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const res = await fetch(`/api/v1/contracts/${contractId}/work-months`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        month: f.get("month"),
        amountYen: parseInt(String(f.get("amountYen"))),
      }),
    });
    setLoading(false);
    if (res.ok) router.refresh();
    else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "確認に失敗しました");
    }
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-3 text-sm">
      {error && <p className="text-xs text-red-600">{error}</p>}
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
      <div>
        <label className="mb-1 block text-xs text-slate-500">確定契約金額（円・月途中は日割り額）</label>
        <input
          type="number"
          name="amountYen"
          required
          min={1}
          defaultValue={defaultAmountYen}
          className="w-40 rounded border border-slate-300 px-2 py-1.5"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="rounded bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        月次確認・手数料計算
      </button>
    </form>
  );
}
