"use client";

// 案件・人材詳細の削除ボタン。確認ダイアログ後に DELETE を呼び、一覧へ戻る
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteResourceButton({
  path,
  confirmText,
  redirectTo,
}: {
  path: string;
  confirmText: string;
  redirectTo: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function del() {
    if (!window.confirm(confirmText)) return;
    setLoading(true);
    setError(null);
    const res = await fetch(path, { method: "DELETE" });
    setLoading(false);
    if (res.ok) {
      router.push(redirectTo);
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "削除に失敗しました");
    }
  }

  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <button
        onClick={del}
        disabled={loading}
        className="rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        {loading ? "削除中..." : "削除"}
      </button>
    </span>
  );
}
