"use client";

import { useState } from "react";
import Link from "next/link";

// マッチング実行・結果表示（§19.3: 総合適合度・適合条件・不足条件・警告）
type MatchRow = {
  engineer?: { id: string; code: string; own: boolean; rateBand: string; ageBand: string };
  project?: { id: string; code: string; own: boolean; name: string; rateMaxYen: number };
  result: {
    score: number;
    breakdown: Record<string, number>;
    matchedConditions: string[];
    missingConditions: string[];
    warnings: string[];
  };
};

export function MatchPanel({
  direction,
  targetId,
}: {
  direction: "project-to-engineers" | "engineer-to-projects";
  targetId: string;
}) {
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    const body =
      direction === "project-to-engineers" ? { projectId: targetId } : { engineerId: targetId };
    const res = await fetch(`/api/v1/matches/${direction}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setLoading(false);
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "マッチングに失敗しました");
      return;
    }
    const data = await res.json();
    setRows(data.results);
  }

  return (
    <div className="mt-8">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-lg font-bold">
          {direction === "project-to-engineers" ? "候補人材マッチング" : "適合案件マッチング"}
        </h2>
        <button
          onClick={run}
          disabled={loading}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {loading ? "計算中..." : "マッチング実行"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {rows && rows.length === 0 && (
        <p className="text-sm text-slate-500">ハードフィルターを通過した候補はありません。</p>
      )}
      {rows && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row, i) => {
            const target = row.engineer ?? row.project;
            if (!target) return null;
            const href = row.engineer ? `/engineers/${target.id}` : `/projects/${target.id}`;
            const title = row.engineer
              ? `${row.engineer.code}（${row.engineer.ageBand} / ${row.engineer.rateBand}）`
              : `${row.project!.code} ${row.project!.name}`;
            return (
              <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <Link href={href} className="font-medium text-blue-700 hover:underline">
                    {title}
                    {target.own ? (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">自社</span>
                    ) : (
                      <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-600">他社</span>
                    )}
                  </Link>
                  <span className="text-2xl font-bold text-emerald-600">{row.result.score}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1 text-xs">
                  {Object.entries(row.result.breakdown).map(([k, v]) => (
                    <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                      {k}: {v}
                    </span>
                  ))}
                </div>
                {row.result.matchedConditions.length > 0 && (
                  <p className="mt-2 text-xs text-emerald-700">✓ {row.result.matchedConditions.join(" / ")}</p>
                )}
                {row.result.missingConditions.length > 0 && (
                  <p className="mt-1 text-xs text-amber-700">△ {row.result.missingConditions.join(" / ")}</p>
                )}
                {row.result.warnings.length > 0 && (
                  <p className="mt-1 text-xs text-red-600">⚠ {row.result.warnings.join(" / ")}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
