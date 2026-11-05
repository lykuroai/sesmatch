"use client";

// 監査ログのエクスポート UI（PRO版仕様書 §4.14）。期間指定で CSV／JSON をダウンロードする。
// 月次送付メールのリンク（?month=&token=）で開いたときは、その月のダウンロードボタンを出す
import { useState } from "react";

export function AuditExportPanel({ pro, monthly }: { pro: boolean; monthly: { month: string; token: string } | null }) {
  const today = new Date();
  const jst = new Date(today.getTime() + 9 * 3600_000);
  const to = jst.toISOString().slice(0, 10);
  const from = new Date(jst.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [range, setRange] = useState({ from, to });
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [error, setError] = useState<string | null>(null);

  async function download(url: string) {
    setError(null);
    const res = await fetch(url);
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "ダウンロードに失敗しました");
      return;
    }
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "audit.csv";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 text-sm">
      <h2 className="mb-1 flex items-center gap-2 font-bold">
        <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">PRO</span>
        監査ログのエクスポート
      </h2>
      <p className="mb-3 text-xs text-stone-500">
        期間を指定して CSV／JSON で出力します（自社分のみ、最大 50,000 件、1年以内）。出力した事実も監査ログに記録されます。
        毎月1日に前月分のダウンロードリンクを代表へメールします（7日間有効）。
      </p>
      {monthly && (
        <div className="mb-3 rounded border border-emerald-300 bg-white p-3 text-xs">
          <p className="mb-2">{monthly.month} 分の月次監査ログ（メールのリンクから）</p>
          <div className="flex gap-2">
            <button onClick={() => download(`/api/v1/audit/export?month=${monthly.month}&token=${encodeURIComponent(monthly.token)}&format=csv`)} className="rounded bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-700">
              CSV をダウンロード
            </button>
            <button onClick={() => download(`/api/v1/audit/export?month=${monthly.month}&token=${encodeURIComponent(monthly.token)}&format=json`)} className="rounded border border-stone-300 px-3 py-1 hover:bg-stone-50">
              JSON
            </button>
          </div>
        </div>
      )}
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="block">
          <span className="mb-1 block text-stone-600">開始日</span>
          <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} disabled={!pro} className="rounded border border-stone-300 px-2 py-1" />
        </label>
        <label className="block">
          <span className="mb-1 block text-stone-600">終了日</span>
          <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} disabled={!pro} className="rounded border border-stone-300 px-2 py-1" />
        </label>
        <label className="block">
          <span className="mb-1 block text-stone-600">形式</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as "csv" | "json")} disabled={!pro} className="rounded border border-stone-300 px-2 py-1">
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
        </label>
        <button
          onClick={() => download(`/api/v1/audit/export?from=${range.from}&to=${range.to}&format=${format}`)}
          disabled={!pro}
          className="rounded bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          ダウンロード
        </button>
        {!pro && <span className="text-stone-500">PRO 版の機能です。</span>}
      </div>
    </section>
  );
}
