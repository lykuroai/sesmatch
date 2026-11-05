import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasFeature } from "@/server/plan/features";
import { listScoutBatches } from "@/server/services/scouts";

// 一斉スカウトの送信履歴と反応率（PRO版仕様書 §4.6）
export default async function ScoutBatchesPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!hasFeature(auth, "bulk_scout")) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold">一斉スカウト</h1>
        <p className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 text-sm text-stone-700">
          一斉スカウト（最大20名/回）・AI 下書き・既読表示・反応率は PRO 版の機能です。
          <Link href="/pricing" className="ml-2 text-emerald-700 hover:underline">料金を見る →</Link>
        </p>
      </div>
    );
  }
  const batches = await listScoutBatches(auth);
  const pct = (v: number | null) => (v == null ? "-" : `${Math.round(v * 100)}%`);
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">
          一斉スカウト <span className="ml-2 align-middle rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">PRO</span>
        </h1>
        <Link href="/engineers?source=other" className="rounded border border-emerald-600 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50">
          人材一覧から一斉スカウトを送る
        </Link>
      </div>
      {batches.length === 0 ? (
        <p className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-400 shadow-sm">送信履歴はまだありません。人材一覧で他社人材を選択して送信できます。</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs text-stone-500">
              <tr>
                <th className="px-4 py-3">送信日時</th>
                <th className="px-4 py-3">案件</th>
                <th className="px-4 py-3">送信</th>
                <th className="px-4 py-3">承認</th>
                <th className="px-4 py-3">辞退</th>
                <th className="px-4 py-3">無反応</th>
                <th className="px-4 py-3">承認率</th>
                <th className="px-4 py-3">スキップ</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-t border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-2">
                    <Link href={`/entries/scouts/${b.id}`} className="text-orange-800 hover:underline">
                      {new Date(b.createdAt).toLocaleString("ja-JP")}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    {b.project.code} <span className="text-xs text-stone-500">{b.project.name}</span>
                  </td>
                  <td className="px-4 py-2">{b.stats.sent}</td>
                  <td className="px-4 py-2">{b.stats.approved}</td>
                  <td className="px-4 py-2">{b.stats.declined}</td>
                  <td className="px-4 py-2">{b.stats.pending}</td>
                  <td className="px-4 py-2 font-medium">{pct(b.stats.approvalRate)}</td>
                  <td className="px-4 py-2 text-xs text-stone-500">{b.skippedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
