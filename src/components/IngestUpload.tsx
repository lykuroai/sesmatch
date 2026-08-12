"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function IngestUpload() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file || loading) return;
    setLoading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/v1/ingestions", { method: "POST", body: form });
    setLoading(false);
    if (res.ok) {
      if (fileRef.current) fileRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "取込に失敗しました");
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    upload(fileRef.current?.files?.[0]);
  }

  return (
    <form onSubmit={submit} className="text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.xls,.xlsx,.txt,.csv,.md,.jpg,.jpeg,.png,.webp"
          required
          className="min-w-0 text-sm"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "処理中..." : "取込開始"}
        </button>
        {/* スマホ: カメラで撮影してそのまま取込（撮影後に自動アップロード） */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => upload(e.currentTarget.files?.[0])}
        />
        <button
          type="button"
          disabled={loading}
          onClick={() => cameraRef.current?.click()}
          className="rounded border border-blue-600 px-4 py-2 font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50 md:hidden"
        >
          {loading ? "処理中..." : "カメラで撮影して取込"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </form>
  );
}
