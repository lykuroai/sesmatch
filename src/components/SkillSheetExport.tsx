"use client";

// スキルシート出力パネル（PRO版仕様書 §4.7）。人材詳細に表示。テンプレート・匿名／実名・形式を選んで出力する
import { useState } from "react";

export function SkillSheetExport({
  engineerId,
  templates,
  namedAllowed,
  namedHint,
}: {
  engineerId: string;
  templates: { id: string; name: string }[];
  namedAllowed: boolean; // 実名版を出せるか（自社=PII権限 / 他社=開示済み）
  namedHint: string;
}) {
  const [template, setTemplate] = useState(templates[0]?.id ?? "standard");
  const [mode, setMode] = useState<"anonymous" | "named">("anonymous");
  const q = `template=${encodeURIComponent(template)}&mode=${mode}`;
  return (
    <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 text-sm">
      <p className="flex items-center gap-2 font-bold text-stone-800">
        <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">PRO</span>
        スキルシート出力（自社書式）
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          書式
          <select value={template} onChange={(e) => setTemplate(e.target.value)} className="rounded border border-stone-300 bg-white px-2 py-1">
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={mode === "anonymous"} onChange={() => setMode("anonymous")} /> 匿名版（人材ID・年代・単価帯）
        </label>
        <label className={`flex items-center gap-1 ${namedAllowed ? "" : "text-stone-400"}`} title={namedAllowed ? "" : namedHint}>
          <input type="radio" disabled={!namedAllowed} checked={mode === "named"} onChange={() => setMode("named")} /> 実名版（氏名・実額単価）
        </label>
        <a href={`/engineers/${engineerId}/sheet?${q}`} target="_blank" rel="noopener" className="rounded border border-emerald-600 px-3 py-1 font-medium text-emerald-700 hover:bg-emerald-50">
          印刷用を開く（PDF 保存）
        </a>
        <a href={`/api/v1/engineers/${engineerId}/skill-sheet/export?${q}`} className="rounded bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-700">
          Excel を出力
        </a>
      </div>
      {!namedAllowed && <p className="mt-1 text-xs text-stone-500">{namedHint}</p>}
      <p className="mt-1 text-xs text-stone-500">出力には性別・顔写真・国籍を含めません。出力は保存されず、監査ログに記録されます。</p>
    </div>
  );
}
