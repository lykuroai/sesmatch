import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { prisma } from "@/server/db";
import { listEngineers } from "@/server/services/engineers";
import {
  AFFILIATION_LABELS,
  ENGINEER_WORK_STATUS_LABELS,
  PUBLISH_STATUS_LABELS,
  REMOTE_LEVEL_LABELS,
} from "@/lib/constants";
import { IngestPanel } from "@/components/IngestPanel";
import { PendingIngestions } from "@/components/PendingIngestions";

export default async function EngineersPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; q?: string }>;
}) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const { scope: scopeParam, q } = await searchParams;
  const scope = scopeParam === "public" ? "public" : "own";
  const query = q?.trim() || undefined;
  const [engineers, pendingJobs] = await Promise.all([
    listEngineers(auth, scope, query),
    prisma.ingestionJob.findMany({
      where: {
        tenantCompanyId: auth.companyId,
        status: "REVIEW_REQUIRED",
        sourceDocument: { kind: "ENGINEER_SHEET" },
      },
      include: { sourceDocument: { select: { filename: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">人材</h1>
        <Link
          href="/engineers/new"
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          人材を登録
        </Link>
      </div>
      <IngestPanel
        label="スキルシート・紹介メールから取込"
        hint="人材のスキルシートや紹介メールの本文を貼り付け・アップロードするだけで登録できます。"
      />
      <PendingIngestions
        jobs={pendingJobs.map((j) => ({
          id: j.id,
          filename: j.sourceDocument.filename,
          createdAt: j.createdAt,
        }))}
      />
      <div className="mb-4 flex gap-2">
        <Link
          href="/engineers"
          className={`rounded px-3 py-1.5 text-sm ${scope === "own" ? "bg-slate-800 text-white" : "bg-white border border-slate-300"}`}
        >
          自社管理人材
        </Link>
        <Link
          href="/engineers?scope=public"
          className={`rounded px-3 py-1.5 text-sm ${scope === "public" ? "bg-slate-800 text-white" : "bg-white border border-slate-300"}`}
        >
          公開人材検索（他社・匿名）
        </Link>
        <form method="GET" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="scope" value={scope} />
          <input
            name="q"
            defaultValue={query ?? ""}
            placeholder="スキル・エリア・概要などで検索"
            className="w-72 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
          />
          <button className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700">
            検索
          </button>
          {query && (
            <Link href={`/engineers?scope=${scope}`} className="text-xs text-slate-500 hover:underline">
              クリア
            </Link>
          )}
        </form>
      </div>
      {query && (
        <p className="mb-3 text-xs text-slate-500">
          「{query}」の検索結果: {engineers.length}件
        </p>
      )}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">人材ID</th>
              <th className="px-4 py-3">年代</th>
              <th className="px-4 py-3">所属区分</th>
              <th className="px-4 py-3">単価帯</th>
              <th className="px-4 py-3">稼働可能日</th>
              <th className="px-4 py-3">在宅希望</th>
              <th className="px-4 py-3">状態</th>
              <th className="px-4 py-3">同意</th>
            </tr>
          </thead>
          <tbody>
            {engineers.map((e) => (
              <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/engineers/${e.id}`} className="font-medium text-blue-700 hover:underline">
                    {e.code}
                    {e.name ? ` ${e.name}` : ""}
                  </Link>
                </td>
                <td className="px-4 py-3">{e.ageBand}</td>
                <td className="px-4 py-3">{AFFILIATION_LABELS[e.affiliationType]}</td>
                <td className="px-4 py-3">{e.rateBand}</td>
                <td className="px-4 py-3">
                  {e.availableFrom ? new Date(e.availableFrom).toLocaleDateString("ja-JP") : "-"}
                </td>
                <td className="px-4 py-3 text-xs">{REMOTE_LEVEL_LABELS[e.remotePreference]}</td>
                <td className="px-4 py-3">
                  {e.status !== "PUBLISHED" && (
                    <span className="mr-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
                      {PUBLISH_STATUS_LABELS[e.status]}
                    </span>
                  )}
                  {/* 未公開の人材は紹介できないため「紹介中」は表示しない */}
                  {(e.status === "PUBLISHED" || e.workStatus !== "PROPOSING") && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        e.workStatus === "WORKING" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"
                      }`}
                    >
                      {ENGINEER_WORK_STATUS_LABELS[e.workStatus]}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">{e.hasValidConsent ? "✓" : <span className="text-red-600">なし</span>}</td>
              </tr>
            ))}
            {engineers.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  該当する人材がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
