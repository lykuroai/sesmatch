"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 稼働開始・稼働前キャンセル・終了（§22, §23）
export function WorkControls({
  contract,
}: {
  contract: { id: string; status: string; workStartedAt: boolean };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function post(path: string, body?: object) {
    setError(null);
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) router.refresh();
    else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "操作に失敗しました");
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col items-end gap-2">
      {error && <p className="max-w-64 text-right text-xs text-red-600">{error}</p>}
      {contract.status === "EXECUTED" && (
        <button
          onClick={() => {
            const d = window.prompt("実稼働開始日（YYYY-MM-DD）", today);
            if (d) post(`/api/v1/contracts/${contract.id}/work-start`, { date: d });
          }}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          稼働開始を記録
        </button>
      )}
      {!contract.workStartedAt && !["CANCELLED", "TERMINATED", "COMPLETED"].includes(contract.status) && (
        <button
          onClick={() => {
            if (window.confirm("稼働前キャンセルしますか？（手数料は発生しません）"))
              post(`/api/v1/contracts/${contract.id}/cancel`);
          }}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          稼働前キャンセル
        </button>
      )}
      {contract.status === "ACTIVE" && (
        <button
          onClick={() => {
            const d = window.prompt("終了日（YYYY-MM-DD）。開始後14日以内の離脱は手数料を全額返金します。", today);
            if (d) post(`/api/v1/contracts/${contract.id}/terminate`, { date: d });
          }}
          className="rounded border border-red-300 bg-white px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
        >
          契約を終了
        </button>
      )}
    </div>
  );
}
