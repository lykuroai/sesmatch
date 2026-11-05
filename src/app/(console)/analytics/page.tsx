import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasFeature } from "@/server/plan/features";
import { getFunnel, getMarketRates, getResponseStats, rangeOfMonths } from "@/server/services/analytics";

// 分析・エクスポート（PRO版仕様書 §4.4）。PC専用（モバイル導線には出さない）。
// 基本版には PRO の案内のみ表示する。判定はサーバー側（hasFeature）で行う

const MONTH_OPTIONS = [1, 3, 6, 12] as const;
const yen = (v: number) => `${Math.round(v / 10_000)}万円`;
const pct = (v: number | null) => (v == null ? "-" : `${Math.round(v * 100)}%`);

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ months?: string }> }) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const sp = await searchParams;
  const months = (MONTH_OPTIONS as readonly number[]).includes(parseInt(sp.months ?? "3")) ? parseInt(sp.months ?? "3") : 3;

  if (!hasFeature(auth, "analytics_export")) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">分析</h1>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-6">
          <p className="flex items-center gap-2 font-bold text-stone-800">
            <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">PRO</span>
            分析・エクスポートは PRO 版の機能です
          </p>
          <ul className="mt-3 space-y-1 text-sm text-stone-600">
            <li>・商談ファネル（申込→承認→面談→契約の件数と転換率）</li>
            <li>・自社案件・人材ごとの反応状況（申込数、承認率、承認までの日数）</li>
            <li>・市場単価レンジ（公開中案件のスキル×都道府県別の匿名統計）</li>
            <li>・案件・人材・商談一覧の CSV エクスポート</li>
          </ul>
          <Link href="/pricing" className="mt-4 inline-block text-sm font-medium text-emerald-700 hover:underline">
            料金と PRO 版の詳細を見る →
          </Link>
        </div>
      </div>
    );
  }

  const range = rangeOfMonths(months);
  const [funnel, response, market] = await Promise.all([getFunnel(auth, range), getResponseStats(auth, range), getMarketRates()]);
  const rows = [funnel.sent, funnel.received, funnel.total];
  const rate = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "-");
  const th = "px-3 py-2 text-left text-xs font-medium text-stone-500";
  const td = "px-3 py-2";

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          分析 <span className="ml-2 align-middle rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">PRO</span>
        </h1>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-xs text-stone-500">集計期間</span>
          {MONTH_OPTIONS.map((m) => (
            <Link
              key={m}
              href={`/analytics?months=${m}`}
              className={`rounded-full border px-3 py-1 text-xs ${m === months ? "border-orange-700 bg-orange-700 text-white" : "border-stone-300 bg-white text-stone-600 hover:bg-stone-50"}`}
            >
              直近{m}か月
            </Link>
          ))}
        </div>
      </div>

      {/* 商談ファネル */}
      <section className="mb-8 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-bold">商談ファネル</h2>
        <p className="mb-3 text-xs text-stone-500">期間内に申込まれた商談の件数と転換率。承認＝双方承認（Level 2 開示）、契約＝条件確認書の相互署名。</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50">
              <tr>
                <th className={th}>区分</th>
                <th className={th}>申込</th>
                <th className={th}>承認</th>
                <th className={th}>面談</th>
                <th className={th}>契約</th>
                <th className={th}>申込→承認</th>
                <th className={th}>承認→契約</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className={`border-t border-stone-100 ${r.label === "合計" ? "font-bold" : ""}`}>
                  <td className={td}>{r.label}</td>
                  <td className={td}>{r.submitted}</td>
                  <td className={td}>{r.approved}</td>
                  <td className={td}>{r.interviewed}</td>
                  <td className={td}>{r.contracted}</td>
                  <td className={td}>{rate(r.approved, r.submitted)}</td>
                  <td className={td}>{rate(r.contracted, r.approved)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 反応状況 */}
      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="mb-1 font-bold">自社案件の反応状況</h2>
          <p className="mb-3 text-xs text-stone-500">期間内の申込数・承認率・申込から双方承認までの平均日数（上位50件）</p>
          {response.projects.length === 0 ? (
            <p className="text-sm text-stone-500">対象の案件がありません。</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-stone-50">
                <tr>
                  <th className={th}>案件</th>
                  <th className={th}>申込</th>
                  <th className={th}>承認</th>
                  <th className={th}>承認率</th>
                  <th className={th}>平均日数</th>
                </tr>
              </thead>
              <tbody>
                {response.projects.map((r) => (
                  <tr key={r.id} className="border-t border-stone-100">
                    <td className={td}>
                      <Link href={`/projects/${r.id}`} className="text-orange-800 hover:underline">
                        {r.code}
                      </Link>
                      <span className="ml-2 text-xs text-stone-500">{r.name}</span>
                    </td>
                    <td className={td}>{r.entries}</td>
                    <td className={td}>{r.approved}</td>
                    <td className={td}>{pct(r.approvalRate)}</td>
                    <td className={td}>{r.avgDaysToApproval ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="mb-1 font-bold">自社人材の反応状況</h2>
          <p className="mb-3 text-xs text-stone-500">期間内の提案・スカウト数と承認率（上位50件。氏名は表示しません）</p>
          {response.engineers.length === 0 ? (
            <p className="text-sm text-stone-500">対象の人材がありません。</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-stone-50">
                <tr>
                  <th className={th}>人材</th>
                  <th className={th}>商談</th>
                  <th className={th}>承認</th>
                  <th className={th}>承認率</th>
                  <th className={th}>平均日数</th>
                </tr>
              </thead>
              <tbody>
                {response.engineers.map((r) => (
                  <tr key={r.id} className="border-t border-stone-100">
                    <td className={td}>
                      <Link href={`/engineers/${r.id}`} className="text-orange-800 hover:underline">
                        {r.code}
                      </Link>
                    </td>
                    <td className={td}>{r.entries}</td>
                    <td className={td}>{r.approved}</td>
                    <td className={td}>{pct(r.approvalRate)}</td>
                    <td className={td}>{r.avgDaysToApproval ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* 市場単価レンジ */}
      <section className="mb-8 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-bold">市場単価レンジ（匿名統計）</h2>
        <p className="mb-3 text-xs text-stone-500">
          プラットフォーム全体の公開中案件（{market.totalProjects}件）の単価上限を必須スキル×都道府県で集計。母数{market.minSample}件未満の組合せは表示しません。企業名・案件名は含みません。
        </p>
        {market.rows.length === 0 ? (
          <p className="text-sm text-stone-500">母数{market.minSample}件以上の組合せがまだありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50">
                <tr>
                  <th className={th}>スキル</th>
                  <th className={th}>都道府県</th>
                  <th className={th}>件数</th>
                  <th className={th}>最小</th>
                  <th className={th}>中央値</th>
                  <th className={th}>最大</th>
                </tr>
              </thead>
              <tbody>
                {market.rows.map((r) => (
                  <tr key={`${r.skill}-${r.prefecture}`} className="border-t border-stone-100">
                    <td className={td}>{r.skill}</td>
                    <td className={td}>{r.prefecture}</td>
                    <td className={td}>{r.count}</td>
                    <td className={td}>{yen(r.minYen)}</td>
                    <td className={`${td} font-medium`}>{yen(r.medianYen)}</td>
                    <td className={td}>{yen(r.maxYen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* エクスポート */}
      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-bold">CSV エクスポート</h2>
        <p className="mb-3 text-xs text-stone-500">
          自社データのみを出力します（UTF-8・BOM 付き。Excel で開けます）。相手企業名・人材氏名は開示済みのものだけ含まれます。出力は監査ログに記録されます。
        </p>
        <div className="flex flex-wrap gap-2 text-sm">
          {(
            [
              ["projects", "案件一覧"],
              ["engineers", "人材一覧"],
              ["entries", "商談一覧"],
            ] as const
          ).map(([kind, label]) => (
            <a
              key={kind}
              href={`/api/v1/analytics/export?kind=${kind}`}
              className="rounded border border-orange-700 px-4 py-2 font-medium text-orange-700 hover:bg-orange-50"
            >
              {label}を CSV で出力
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
