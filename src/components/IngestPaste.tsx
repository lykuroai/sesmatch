"use client";

// テキスト貼り付け取込（§9.1: メール本文・案件票等をそのまま貼り付けて取込む）
import { useState } from "react";
import { useRouter } from "next/navigation";

export function IngestPaste({
  expectedKind,
}: {
  expectedKind: "ENGINEER_SHEET" | "PROJECT_DESCRIPTION"; // 取込元パネルの期待種別（サーバーで判定結果と突き合わせ）
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    const res = await fetch("/api/v1/ingestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, title: title || undefined, expectedKind }),
    });
    setLoading(false);
    if (res.ok) {
      setText("");
      setTitle("");
      setInfo("取込を受け付けました。AI解析に1分ほどかかります（完了すると一覧に自動で表示されます）");
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "取込に失敗しました");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {info && <p className="rounded bg-emerald-50 p-2 text-sm text-emerald-700">{info}</p>}
      <div>
        <label className="mb-1 block text-xs text-slate-500">タイトル（任意・履歴での表示名）</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full max-w-2xl rounded border border-slate-300 px-2 py-1.5 text-sm"
          placeholder="例: ○○案件のご紹介メール"
        />
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        className="w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm"
        placeholder={
          "メール本文やスキルシート・案件票のテキストをここに貼り付けてください。\n\n例:\nお世話になっております。下記案件のご紹介です。\n【案件名】ECサイトリニューアル\n【単価】〜80万円\n【必須】Java, Spring Boot\n..."
        }
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={loading || !text.trim()}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "処理中...（PII匿名化 → LLM抽出）" : "貼り付けて取込"}
        </button>
        <span className="text-xs text-slate-400">{text.length.toLocaleString()} / 100,000 文字</span>
      </div>
    </form>
  );
}
