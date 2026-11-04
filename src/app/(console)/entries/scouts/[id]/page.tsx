import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasFeature } from "@/server/plan/features";
import { getScoutBatch } from "@/server/services/scouts";
import { ENTRY_STATUS_LABELS } from "@/lib/constants";

// 一斉スカウト1回分の反応状況（PRO版仕様書 §4.6）
export default async function ScoutBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!hasFeature(auth, "bulk_scout")) redirect("/entries/scouts");
  const { id } = await params;
  const b = await getScoutBatch(auth, id);
  if (!b) notFound();
  const pct = (v: number | null) => (v == null ? "-" : `${Math.round(v * 100)}%`);
  const cards = [
    ["送信", b.stats.sent],
    ["承認", b.stats.approved],
    ["辞退", b.stats.declined],
    ["無反応", b.stats.pending],
    ["承認率", pct(b.stats.approvalRate)],
  ] as const;
  return (
    <div>
      <Link href="/entries/scouts" className="text-sm text-blue-700 hover:underline">← 一斉スカウト一覧</Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold">
        {b.project.code} {b.project.name}
      </h1>
      <p className="mb-6 text-sm text-slate-500">
        送信 {new Date(b.createdAt).toLocaleString("ja-JP")} ／ 依頼 {b.requestedCount}名・作成 {b.createdCount}件・スキップ {b.skippedCount}件
      </p>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>
      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-2 font-bold">送信したスカウト文（テンプレート）</h2>
        <p className="whitespace-pre-wrap text-sm text-slate-700">{b.templateBody}</p>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">人材</th>
              <th className="px-4 py-3">状況</th>
              <th className="px-4 py-3">既読</th>
              <th className="px-4 py-3">商談</th>
            </tr>
          </thead>
          <tbody>
            {b.entries.map((e) => (
              <tr key={e.id} className="border-t border-slate-100">
                <td className="px-4 py-2">
                  <Link href={`/engineers/${e.engineerId}`} className="text-blue-700 hover:underline">{e.engineerCode}</Link>
                </td>
                <td className="px-4 py-2">{ENTRY_STATUS_LABELS[e.status] ?? e.status}</td>
                <td className="px-4 py-2 text-xs">{e.read ? <span className="text-emerald-700">既読</span> : <span className="text-slate-400">未読</span>}</td>
                <td className="px-4 py-2">
                  <Link href={`/entries/${e.id}`} className="text-blue-700 hover:underline">詳細</Link>
                </td>
              </tr>
            ))}
            {b.entries.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-400">作成された商談はありません</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
