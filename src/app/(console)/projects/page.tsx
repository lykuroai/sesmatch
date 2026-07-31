import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { prisma } from "@/server/db";
import { listProjects } from "@/server/services/projects";
import { PUBLISH_STATUS_LABELS, REMOTE_LEVEL_LABELS } from "@/lib/constants";
import { IngestPanel } from "@/components/IngestPanel";
import { PendingIngestions } from "@/components/PendingIngestions";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; q?: string }>;
}) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const { scope: scopeParam, q } = await searchParams;
  const scope = scopeParam === "public" ? "public" : "own";
  const query = q?.trim() || undefined;
  const [projects, pendingJobs] = await Promise.all([
    listProjects(auth, scope, query),
    prisma.ingestionJob.findMany({
      where: {
        tenantCompanyId: auth.companyId,
        status: "REVIEW_REQUIRED",
        sourceDocument: { kind: "PROJECT_DESCRIPTION" },
      },
      include: { sourceDocument: { select: { filename: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">案件</h1>
        <Link
          href="/projects/new"
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          案件を登録
        </Link>
      </div>
      <IngestPanel
        label="案件票・紹介メールから取込"
        hint="案件票や紹介メールの本文を貼り付け・アップロードするだけで登録できます。"
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
          href="/projects"
          className={`rounded px-3 py-1.5 text-sm ${scope === "own" ? "bg-slate-800 text-white" : "bg-white border border-slate-300"}`}
        >
          自社案件
        </Link>
        <Link
          href="/projects?scope=public"
          className={`rounded px-3 py-1.5 text-sm ${scope === "public" ? "bg-slate-800 text-white" : "bg-white border border-slate-300"}`}
        >
          公開案件検索（他社）
        </Link>
        <form method="GET" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="scope" value={scope} />
          <input
            name="q"
            defaultValue={query ?? ""}
            placeholder="案件名・スキル・勤務地などで検索"
            className="w-72 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
          />
          <button className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700">
            検索
          </button>
          {query && (
            <Link href={`/projects?scope=${scope}`} className="text-xs text-slate-500 hover:underline">
              クリア
            </Link>
          )}
        </form>
      </div>
      {query && (
        <p className="mb-3 text-xs text-slate-500">
          「{query}」の検索結果: {projects.length}件
        </p>
      )}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">案件ID</th>
              <th className="px-4 py-3">案件名</th>
              <th className="px-4 py-3">開始日</th>
              <th className="px-4 py-3">単価上限</th>
              <th className="px-4 py-3">出社/在宅</th>
              <th className="px-4 py-3">必須スキル</th>
              <th className="px-4 py-3">状態</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/projects/${p.id}`} className="font-medium text-blue-700 hover:underline">
                    {p.code}
                  </Link>
                </td>
                <td className="px-4 py-3">{p.name}</td>
                <td className="px-4 py-3">{new Date(p.startDate).toLocaleDateString("ja-JP")}</td>
                <td className="px-4 py-3">{(p.rateMaxYen / 10_000).toLocaleString()}万円</td>
                <td className="px-4 py-3 text-xs">{REMOTE_LEVEL_LABELS[p.remoteLevel]}</td>
                <td className="px-4 py-3 text-xs">{p.requiredSkills.map((s) => s.name).join(", ")}</td>
                <td className="px-4 py-3">{PUBLISH_STATUS_LABELS[p.status]}</td>
              </tr>
            ))}
            {projects.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  該当する案件がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
