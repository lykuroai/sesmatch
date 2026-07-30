"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function IngestUpload() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/v1/ingestions", { method: "POST", body: form });
    setLoading(false);
    if (res.ok) {
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "取込に失敗しました");
    }
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-3 text-sm">
      <input ref={fileRef} type="file" accept=".txt,.csv,.md" required className="text-sm" />
      <button
        type="submit"
        disabled={loading}
        className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "処理中..." : "取込開始"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
