import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { getProject } from "@/server/services/projects";
import { hasPermission } from "@/server/auth/rbac";
import { DeleteResourceButton } from "@/components/DeleteResourceButton";
import {
  AFFILIATION_LABELS,
  PROJECT_WORKFLOW_LABELS,
  PUBLISH_STATUS_LABELS,
  REMOTE_LEVEL_LABELS,
} from "@/lib/constants";
import { WorkflowStatusSelect } from "@/components/WorkflowStatusSelect";
import { ActionButton } from "@/components/ActionButton";
import { MatchPanel } from "@/components/MatchPanel";
import { EntryCreate } from "@/components/EntryCreate";
import { ResizableColumns } from "@/components/ResizableColumns";
import { listEngineers } from "@/server/services/engineers";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const { id } = await params;
  const p = await getProject(auth, id);
  if (!p) notFound();

  const canPublish = p.own && hasPermission(auth.roles, "project.publish");
  const canMatch = p.own && hasPermission(auth.roles, "match.run");
  const canPropose = !p.own && hasPermission(auth.roles, "entry.submit");

  // 他社案件: 提案候補となる自社の公開・同意済み人材（§20.1）
  const proposalOptions = canPropose
    ? (await listEngineers(auth, "own")).items
        .filter((e) => e.status === "PUBLISHED" && e.hasValidConsent)
        .map((e) => ({
          id: e.id,
          label: `${e.code}${e.name ? ` ${e.name}` : ""}（${e.rateBand}）`,
          subtier: e.affiliationType === "SUBTIER1",
        }))
    : [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {p.code} {p.name}
            {!p.own && <span className="ml-3 rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-600">他社案件</span>}
          </h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-slate-500">
            {p.status !== "PUBLISHED" && (
              <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                {PUBLISH_STATUS_LABELS[p.status]}
              </span>
            )}
            {/* 未公開の案件は応募を受けられないため進行状態（応募中）は表示・設定しない */}
            {(p.status === "PUBLISHED" || p.workflowStatus !== "RECRUITING") &&
              (p.own && hasPermission(auth.roles, "project.create") ? (
                <WorkflowStatusSelect
                  path={`/api/v1/projects/${p.id}/workflow-status`}
                  current={p.workflowStatus}
                  options={Object.entries(PROJECT_WORKFLOW_LABELS).map(([value, label]) => ({ value, label }))}
                />
              ) : (
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    p.workflowStatus === "RECRUITING"
                      ? "bg-blue-50 text-blue-700"
                      : p.workflowStatus === "CONTRACTED"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {PROJECT_WORKFLOW_LABELS[p.workflowStatus]}
                </span>
              ))}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {p.own && hasPermission(auth.roles, "project.create") && (
            <>
              <a
                href={`/projects/${p.id}/edit`}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                編集
              </a>
              <DeleteResourceButton
                path={`/api/v1/projects/${p.id}`}
                confirmText="この案件を削除しますか？（元に戻せません。エントリーがある案件は削除できません）"
                redirectTo="/projects"
              />
            </>
          )}
          {canPublish && p.status !== "PUBLISHED" && (
            <ActionButton path={`/api/v1/projects/${p.id}/publish`} label="公開する" />
          )}
        </div>
      </div>

      <ResizableColumns
        storageKey="project-detail-columns"
        left={
          <section className="h-full rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">案件条件</h2>
          <dl className="space-y-2 text-sm">
            <Row label="開始日" value={new Date(p.startDate).toLocaleDateString("ja-JP")} />
            <Row label="募集人数" value={`${p.headcount}名`} />
            <Row
              label="単価"
              value={`${p.rateMinYen ? (p.rateMinYen / 10_000).toLocaleString() + "〜" : "〜"}${(p.rateMaxYen / 10_000).toLocaleString()}万円`}
            />
            <Row label="勤務地" value={p.locationCity ?? "-"} />
            <Row label="出社" value={`週${p.onsiteDaysPerWeek}日 / ${REMOTE_LEVEL_LABELS[p.remoteLevel]}`} />
            <Row label="契約形態" value={p.contractType ?? "-"} />
            <Row label="業種" value={p.industry ?? "-"} />
            <Row label="工程" value={p.processes.join(", ") || "-"} />
            <Row label="一社下" value={p.allowSubtier ? "可（最大商流1）" : "不可"} />
            <Row
              label="受入所属区分"
              value={p.acceptedTypes.map((t) => AFFILIATION_LABELS[t]).join(", ")}
            />
            <Row label="面談回数" value={`${p.interviewCount}回`} />
          </dl>
          </section>
        }
        right={
          <section className="h-full rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">スキル要件</h2>
          <p className="mb-1 text-xs text-slate-500">必須</p>
          <div className="mb-3 flex flex-wrap gap-1">
            {p.requiredSkills.map((s) => (
              <span key={s.name} className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                {s.name}
                {s.minMonths ? `（${s.minMonths}ヶ月〜）` : ""}
              </span>
            ))}
            {p.requiredSkills.length === 0 && <span className="text-xs text-slate-400">なし</span>}
          </div>
          <p className="mb-1 text-xs text-slate-500">尚可</p>
          <div className="flex flex-wrap gap-1">
            {p.preferredSkills.map((s) => (
              <span key={s.name} className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">
                {s.name}
              </span>
            ))}
            {p.preferredSkills.length === 0 && <span className="text-xs text-slate-400">なし</span>}
          </div>
          <h2 className="mb-2 mt-5 font-bold">匿名概要</h2>
          <p className="whitespace-pre-wrap text-sm text-slate-600">{p.anonymousSummary}</p>
          </section>
        }
      />

      {p.maskedSourceText && (
        <details className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <summary className="cursor-pointer font-bold">取込原文（匿名化済み）</summary>
          <pre className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap rounded bg-slate-50 p-4 text-sm text-slate-700">
            {p.maskedSourceText}
          </pre>
        </details>
      )}

      {canPropose && (
        <EntryCreate
          type="PROPOSAL"
          fixedProjectId={p.id}
          options={proposalOptions}
          showSubtierCheck
        />
      )}

      {canMatch && (
        <MatchPanel
          direction="project-to-engineers"
          targetId={p.id}
          canEntry={p.own && hasPermission(auth.roles, "entry.submit")}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
