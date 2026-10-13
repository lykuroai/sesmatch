import type { SkillDistribution } from "@/server/services/dashboard";

// ホームの「案件と人材：主要なスキル分布」（横並びのグループ棒グラフ、サーバー描画）。
// 1行=1スキル、上段=案件数（青）、下段=人材数（橙）。両系列とも件数なので共通の1軸で描く。
// 色だけに頼らない: 凡例＋各棒の末尾に値を直接表示し、行ごとに title でツールチップを出す。
const SERIES = {
  projects: { label: "案件", color: "#2a78d6" },
  engineers: { label: "人材", color: "#eb6834" },
} as const;

export function SkillDistributionChart({ data }: { data: SkillDistribution }) {
  const { rows, totalProjects, totalEngineers } = data;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.projects, r.engineers)));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold">案件と人材：主要なスキル分布</h2>
        <p className="text-xs text-slate-500">
          プラットフォーム全体の公開中案件 {totalProjects} 件（必須スキルのみ）・営業中人材 {totalEngineers} 名（上位 {rows.length} スキル）
        </p>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600" aria-label="凡例">
        {(Object.keys(SERIES) as (keyof typeof SERIES)[]).map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: SERIES[k].color }} aria-hidden />
            {SERIES[k].label}
          </li>
        ))}
      </ul>

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">集計対象の公開中案件・営業中人材がまだありません。</p>
      ) : (
        <ol className="mt-4 space-y-2.5">
          {rows.map((r) => (
            <li
              key={r.name}
              className="grid grid-cols-[minmax(0,7rem)_1fr] items-center gap-3 sm:grid-cols-[minmax(0,10rem)_1fr]"
              title={`${r.name}: 案件 ${r.projects} 件 / 人材 ${r.engineers} 名`}
            >
              <span className="truncate text-sm text-slate-700">{r.name}</span>
              <div className="space-y-0.5">
                {(["projects", "engineers"] as const).map((k) => (
                  <div key={k} className="flex items-center gap-2">
                    <div
                      className="h-2.5 shrink-0 rounded-r"
                      style={{ width: `${(r[k] / max) * 100}%`, backgroundColor: SERIES[k].color, minWidth: r[k] > 0 ? 2 : 0 }}
                      role="img"
                      aria-label={`${SERIES[k].label} ${r[k]}`}
                    />
                    <span className="text-xs tabular-nums text-slate-500">{r[k]}</span>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
