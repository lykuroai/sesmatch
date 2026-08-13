"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// API へ POST して結果を反映する汎用ボタン
export function ActionButton({
  path,
  body,
  label,
  confirmMessage,
  variant = "primary",
}: {
  path: string;
  body?: object;
  label: string;
  confirmMessage?: string;
  variant?: "primary" | "secondary"; // secondary: 枠線のみの控えめ表示（非公開化など）
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setLoading(true);
    setError(null);
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    setLoading(false);
    if (res.ok) {
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? b?.error?.code ?? "エラーが発生しました");
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={run}
        disabled={loading}
        className={
          variant === "secondary"
            ? "rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            : "rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        }
      >
        {loading ? "処理中..." : label}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
