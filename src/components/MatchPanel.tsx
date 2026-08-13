"use client";

import { useState } from "react";
import Link from "next/link";

// マッチング実行・結果表示（§19.3: 総合適合度・適合条件・不足条件・警告）
// 他社候補にはエントリー作成ボタンを表示（案件→人材: スカウト / 人材→案件: 人材提案 §20.1）。
// 自社→自社はエントリー対象外のためボタンなし
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

type EntryState = { status: "done" | "error"; message?: string; entryId?: string };

export function MatchPanel({
  direction,
  targetId,
  canEntry = false,
}: {
  direction: "project-to-engineers" | "engineer-to-projects";
  targetId: string;
  canEntry?: boolean; // entry.submit 権限（他社候補へのスカウト/提案ボタンを表示）
}) {
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [minScore, setMinScore] = useState(90); // 適合度のしきい値（既定: 90%以上）
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entryStates, setEntryStates] = useState<Record<string, EntryState>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);

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
    setEntryStates({});
  }

  // スカウト（案件→他社人材）/ 人材提案（人材→他社案件）のエントリー作成
  async function createEntry(counterpartId: string) {
    setSubmitting(counterpartId);
    const body =
      direction === "project-to-engineers"
        ? { type: "SCOUT", projectId: targetId, engineerId: counterpartId }
        : { type: "PROPOSAL", projectId: counterpartId, engineerId: targetId };
    const res = await fetch("/api/v1/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSubmitting(null);
    if (res.ok) {
      const entry = await res.json();
      setEntryStates((s) => ({ ...s, [counterpartId]: { status: "done", entryId: entry.id } }));
    } else {
      const b = await res.json().catch(() => null);
      setEntryStates((s) => ({
        ...s,
        [counterpartId]: { status: "error", message: b?.error?.message ?? "作成に失敗しました" },
      }));
    }
  }

  const actionLabel = direction === "project-to-engineers" ? "商談を申し込む" : "人材提案";
  // 適合度のしきい値で表示を絞り込む（計算結果はしきい値に関係なく全件保持）
  const visible = rows?.filter((r) => r.result.score >= minScore) ?? null;

  return (
    <div className="mt-8">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">
          {direction === "project-to-engineers" ? "候補人材マッチング" : "適合案件マッチング"}
        </h2>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          適合度
          <select
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          >
            <option value={90}>90%以上</option>
            <option value={80}>80%以上</option>
            <option value={70}>70%以上</option>
            <option value={0}>すべて</option>
          </select>
        </label>
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
      {rows && rows.length > 0 && visible && visible.length === 0 && (
        <p className="text-sm text-slate-500">
          適合度{minScore}%以上の候補はありません（全{rows.length}件。しきい値を下げると表示されます）。
        </p>
      )}
      {visible && visible.length > 0 && (
        <div className="space-y-3">
          {rows && rows.length > visible.length && (
            <p className="text-xs text-slate-500">
              適合度{minScore}%以上の{visible.length}件を表示（全{rows.length}件）
            </p>
          )}
          {visible.map((row, i) => {
            const target = row.engineer ?? row.project;
            if (!target) return null;
            const href = row.engineer ? `/engineers/${target.id}` : `/projects/${target.id}`;
            const title = row.engineer
              ? `${row.engineer.code}（${row.engineer.ageBand} / ${row.engineer.rateBand}）`
              : `${row.project!.code} ${row.project!.name}`;
            const entryState = entryStates[target.id];
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
                  <span className="flex items-center gap-3">
                    {/* 他社候補のみエントリー作成可（自社→自社は対象外） */}
                    {canEntry && !target.own && !entryState?.entryId && (
                      <button
                        onClick={() => createEntry(target.id)}
                        disabled={submitting === target.id}
                        className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {submitting === target.id ? "作成中..." : actionLabel}
                      </button>
                    )}
                    {entryState?.entryId && (
                      <Link
                        href={`/entries/${entryState.entryId}`}
                        className="rounded bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:underline"
                      >
                        商談申込み済み →
                      </Link>
                    )}
                    <span className="text-2xl font-bold text-emerald-600">{row.result.score}</span>
                  </span>
                </div>
                {entryState?.status === "error" && (
                  <p className="mt-1 text-xs text-red-600">{entryState.message}</p>
                )}
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
