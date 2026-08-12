"use client";

// ファイル取込＋スマホのカメラ撮影取込。
// 複数ページの書類は、画像を複数選択（PC）または1ページずつ続けて撮影（スマホ）して
// まとめて送ると、サーバー側で1件（1つのPDF原本）として取り込まれる
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const MAX_IMAGES = 10; // サーバー側 MAX_MERGE_IMAGES と揃える

export function IngestUpload() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [shots, setShots] = useState<File[]>([]); // カメラで撮影したページ画像
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isImage = (f: File) => f.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(f.name);

  async function upload(files: File[]) {
    if (files.length === 0 || loading) return;
    if (files.length > 1 && !files.every(isImage)) {
      setError("まとめて取込できるのは画像（撮影ページ）のみです。書類ファイルは1件ずつ取り込んでください");
      return;
    }
    if (files.length > MAX_IMAGES) {
      setError(`まとめて取り込める画像は${MAX_IMAGES}枚までです`);
      return;
    }
    setLoading(true);
    setError(null);
    const form = new FormData();
    for (const f of files) form.append("file", f);
    const res = await fetch("/api/v1/ingestions", { method: "POST", body: form });
    setLoading(false);
    if (res.ok) {
      if (fileRef.current) fileRef.current.value = "";
      setShots([]);
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "取込に失敗しました");
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    upload(Array.from(fileRef.current?.files ?? []));
  }

  return (
    <div className="space-y-3 text-sm">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          multiple
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
      </form>

      {/* スマホ: カメラで1ページずつ撮影し、まとめて1件として取込 */}
      <div className="md:hidden">
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) setShots((s) => [...s, f]);
            e.currentTarget.value = "";
          }}
        />
        {shots.length === 0 ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => cameraRef.current?.click()}
            className="rounded border border-blue-600 px-4 py-2 font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
          >
            カメラで撮影して取込
          </button>
        ) : (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
            <p className="mb-2 text-xs text-slate-600">
              撮影済み {shots.length} ページ（複数ページはこのまま続けて撮影できます）
            </p>
            <ul className="mb-3 flex flex-wrap gap-2">
              {shots.map((f, i) => (
                <li key={i} className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2 py-1 text-xs">
                  {i + 1}ページ目
                  <button
                    type="button"
                    onClick={() => setShots(shots.filter((_, j) => j !== i))}
                    aria-label={`${i + 1}ページ目を削除`}
                    className="text-slate-400 hover:text-red-600"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={loading || shots.length >= MAX_IMAGES}
                onClick={() => cameraRef.current?.click()}
                className="rounded border border-blue-600 px-4 py-2 font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
              >
                続けて撮影（次のページ）
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => upload(shots)}
                className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? "処理中..." : `この${shots.length}ページで取込開始`}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => setShots([])}
                className="rounded border border-slate-300 px-4 py-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                やり直す
              </button>
            </div>
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
