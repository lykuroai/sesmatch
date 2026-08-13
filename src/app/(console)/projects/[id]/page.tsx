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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {p.code} {p.name}
            {!p.own && <span className="ml-3 rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-600">他社案件</span>}
          </h1>
          {/* 状態表示: 「公開状態」（自社のみ）と「案件状況」をラベル付きで並べる */}
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {p.own && (
              <span className="flex items-center gap-1.5">
                <span className="shrink-0 whitespace-nowrap text-xs text-slate-500">公開状態</span>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    p.status === "PUBLISHED"
                      ? "bg-emerald-50 text-emerald-700"
                      : p.status === "DRAFT"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {PUBLISH_STATUS_LABELS[p.status]}
                </span>
                {p.status === "DRAFT" && (
                  <span className="text-xs text-slate-400">他社には表示されません（「公開する」で公開）</span>
                )}
                {/* 公開の取り下げ（手動で下書きへ戻す） */}
                {p.status === "PUBLISHED" && canPublish && (
                  <ActionButton
                    path={`/api/v1/projects/${p.id}/unpublish`}
                    label="非公開にする"
                    variant="secondary"
                    confirmMessage="非公開（下書き）に戻しますか？他社の検索・マッチング対象から外れます。進行中の商談には影響しません。"
                  />
                )}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className="shrink-0 whitespace-nowrap text-xs text-slate-500">案件状況</span>
              {p.own && hasPermission(auth.roles, "project.create") ? (
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
              )}
            </span>
          </div>
          {p.own && hasPermission(auth.roles, "project.create") && (
            <p className="mt-1 text-xs text-slate-400">
              案件状況は商談開始・成約で自動更新されます。プルダウンから手動でも変更できます
            </p>
          )}
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
                confirmText="この案件を削除しますか？（元に戻せません。商談がある案件は削除できません）"
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
            <Row label="出社/在宅" value={`${REMOTE_LEVEL_LABELS[p.remoteLevel]}（週${p.onsiteDaysPerWeek}日出社）`} />
            <Row label="契約形態" value={p.contractType ?? "-"} />
            {p.contractType === "労働者派遣" && (
              <>
                <Row
                  label="抵触日"
                  value={
                    p.dispatchConflictDate
                      ? new Date(p.dispatchConflictDate).toLocaleDateString("ja-JP")
                      : "-"
                  }
                />
                <Row label="派遣先責任者" value={p.dispatchDemandManager ?? "-"} />
                <Row
                  label="派遣禁止業務"
                  value={p.dispatchProhibitedConfirmed ? "非該当（確認済み）" : "未確認"}
                />
              </>
            )}
            <Row label="業種" value={p.industry ?? "-"} />
            <Row label="工程" value={p.processes.join(", ") || "-"} />
            <Row label="一社下" value={p.allowSubtier ? "可（最大商流1）" : "不可"} />
            <Row label="外国籍" value={p.noForeignNational ? "不可" : "可"} />
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

      {/* 終了した案件は新たなマッチングを行わない */}
      {canMatch && p.workflowStatus !== "ENDED" && (
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
