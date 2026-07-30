import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { listProjects } from "@/server/services/projects";
import { PUBLISH_STATUS_LABELS, REMOTE_LEVEL_LABELS } from "@/lib/constants";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const { scope: scopeParam } = await searchParams;
  const scope = scopeParam === "public" ? "public" : "own";
  const projects = await listProjects(auth, scope);

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
      </div>
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
