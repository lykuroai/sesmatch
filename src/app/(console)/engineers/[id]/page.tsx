import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { getEngineer } from "@/server/services/engineers";
import { hasPermission } from "@/server/auth/rbac";
import { DeleteResourceButton } from "@/components/DeleteResourceButton";
import {
  AFFILIATION_LABELS,
  ENGINEER_WORK_STATUS_LABELS,
  PUBLISH_STATUS_LABELS,
  REMOTE_LEVEL_LABELS,
  SKILL_CATEGORY_LABELS,
} from "@/lib/constants";
import { WorkflowStatusSelect } from "@/components/WorkflowStatusSelect";
import { ActionButton } from "@/components/ActionButton";
import { MatchPanel } from "@/components/MatchPanel";
import { ConsentForm } from "@/components/ConsentForm";
import { EntryCreate } from "@/components/EntryCreate";
import { ResizableColumns } from "@/components/ResizableColumns";
import { listProjects } from "@/server/services/projects";

export default async function EngineerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const { id } = await params;
  const e = await getEngineer(auth, id);
  if (!e) notFound();

  const canPublish = e.own && hasPermission(auth.roles, "engineer.publish");
  const canConsent = e.own && hasPermission(auth.roles, "consent.manage");
  const canMatch = e.own && hasPermission(auth.roles, "match.run");
  const canScout = !e.own && hasPermission(auth.roles, "entry.submit");

  // 他社人材: スカウト先となる自社の公開案件（§20.1）。成約・終了した案件は提案対象外
  const scoutOptions = canScout
    ? (await listProjects(auth, "own")).items
        .filter(
          (p) => p.status === "PUBLISHED" && !["CONTRACTED", "ENDED"].includes(p.workflowStatus)
        )
        .map((p) => ({ id: p.id, label: `${p.code} ${p.name}` }))
    : [];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {e.code}
            {e.name && <span className="ml-2">{e.name}</span>}
            {!e.own && <span className="ml-3 rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-600">他社（匿名表示）</span>}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {e.ageBand} / {AFFILIATION_LABELS[e.affiliationType]}
          </p>
          {/* 状態表示: 「公開状態」（自社のみ）と「稼働状況」をラベル付きで並べる */}
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {e.own && (
              <span className="flex items-center gap-1.5">
                <span className="shrink-0 whitespace-nowrap text-xs text-slate-500">公開状態</span>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    e.status === "PUBLISHED"
                      ? "bg-emerald-50 text-emerald-700"
                      : e.status === "DRAFT"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {PUBLISH_STATUS_LABELS[e.status]}
                </span>
                {e.status === "DRAFT" && (
                  <span className="text-xs text-slate-400">他社には表示されません（「公開する」で公開）</span>
                )}
                {/* 公開の取り下げ（手動で下書きへ戻す） */}
                {e.status === "PUBLISHED" && canPublish && (
                  <ActionButton
                    path={`/api/v1/engineers/${e.id}/unpublish`}
                    label="非公開にする"
                    variant="secondary"
                    confirmMessage="非公開（下書き）に戻しますか？他社の検索・マッチング対象から外れます。進行中の商談には影響しません。"
                  />
                )}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className="shrink-0 whitespace-nowrap text-xs text-slate-500">稼働状況</span>
              {e.own && hasPermission(auth.roles, "engineer.create") ? (
                <WorkflowStatusSelect
                  path={`/api/v1/engineers/${e.id}/work-status`}
                  current={e.workStatus}
                  options={Object.entries(ENGINEER_WORK_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
                />
              ) : (
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    e.workStatus === "WORKING" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"
                  }`}
                >
                  {ENGINEER_WORK_STATUS_LABELS[e.workStatus]}
                </span>
              )}
            </span>
          </div>
          {e.own && hasPermission(auth.roles, "engineer.create") && (
            <p className="mt-1 text-xs text-slate-400">
              稼働状況は商談開始・成約で自動更新されます。プルダウンから手動でも変更できます
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* 職務経歴書（原本・PII含む）: 自社のPII権限保持者のみダウンロード可 */}
          {e.own && e.skillSheetFilename && hasPermission(auth.roles, "engineer.read.pii") && (
            <a
              href={`/api/v1/engineers/${e.id}/skill-sheet`}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              title={e.skillSheetFilename}
            >
              職務経歴書
            </a>
          )}
          {e.own && hasPermission(auth.roles, "engineer.create") && (
            <>
              <a
                href={`/engineers/${e.id}/edit`}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                編集
              </a>
              <DeleteResourceButton
                path={`/api/v1/engineers/${e.id}`}
                confirmText="この人材を削除しますか？（一覧・検索から除外されます。進行中の商談がある場合は削除できません）"
                redirectTo="/engineers"
              />
            </>
          )}
          {canPublish && e.status !== "PUBLISHED" && (
            <ActionButton path={`/api/v1/engineers/${e.id}/publish`} label="公開する" />
          )}
        </div>
      </div>

      <ResizableColumns
        storageKey="engineer-detail-columns"
        left={
          <section className="h-full rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">基本情報</h2>
          <dl className="space-y-2 text-sm">
            <Row label="単価帯（公開）" value={e.rateBand} />
            {e.desiredRateYen != null && (
              <Row label="希望単価（実額・PII権限）" value={`${e.desiredRateYen.toLocaleString()}円`} />
            )}
            <Row label="居住エリア" value={e.residenceCity ?? "-"} />
            <Row
              label="稼働可能日"
              value={e.availableFrom ? new Date(e.availableFrom).toLocaleDateString("ja-JP") : "-"}
            />
            <Row label="稼働率" value={`${e.availabilityRate}%`} />
            <Row
              label="在宅希望（許容出社条件）"
              value={`${REMOTE_LEVEL_LABELS[e.remotePreference]}${e.maxOnsiteDaysPerWeek != null ? `（週最大${e.maxOnsiteDaysPerWeek}日出社）` : ""}`}
            />
            <Row label="工程" value={e.processes.join(", ") || "-"} />
            <Row label="役割" value={e.roles.join(", ") || "-"} />
            <Row label="業種経験" value={e.industries.join(", ") || "-"} />
            <Row label="本人同意" value={e.hasValidConsent ? "有効" : "なし"} />
            {e.own && (
              <Row label="国籍" value={e.nationality?.trim() ? e.nationality : "日本（未指定）"} />
            )}
          </dl>
          {e.summary && <p className="mt-4 whitespace-pre-wrap text-sm text-slate-600">{e.summary}</p>}
          </section>
        }
        right={
          <section className="h-full rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">スキル</h2>
          {/* スキルが多い場合は高さを制限してスクロール（ヘッダー行は固定） */}
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1">分類</th>
                  <th className="py-1">名称</th>
                  <th className="py-1">経験</th>
                  <th className="py-1">最終利用</th>
                </tr>
              </thead>
              <tbody>
                {e.skills.map((s) => (
                  <tr key={s.name} className="border-t border-slate-100">
                    <td className="py-1.5 text-xs text-slate-500">{SKILL_CATEGORY_LABELS[s.category]}</td>
                    <td className="py-1.5 font-medium">{s.name}</td>
                    <td className="py-1.5">{formatMonths(s.months)}</td>
                    <td className="py-1.5">
                      {s.lastUsedAt ? new Date(s.lastUsedAt).toLocaleDateString("ja-JP") : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </section>
        }
      />

      {e.maskedSourceText && (
        <details className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <summary className="cursor-pointer font-bold">取込原文（匿名化済み）</summary>
          <pre className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap rounded bg-slate-50 p-4 text-sm text-slate-700">
            {e.maskedSourceText}
          </pre>
        </details>
      )}

      {canConsent && (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">本人同意の登録</h2>
          <ConsentForm engineerId={e.id} />
        </section>
      )}

      {canScout && (
        <EntryCreate type="SCOUT" fixedEngineerId={e.id} options={scoutOptions} />
      )}

      {/* 成約・稼働中の人材は新たなマッチングを行わない。非公開（下書き・停止中）は実行不可 */}
      {canMatch && !["CONTRACTED", "WORKING"].includes(e.workStatus) && (
        <MatchPanel
          direction="engineer-to-projects"
          targetId={e.id}
          canEntry={e.own && hasPermission(auth.roles, "entry.submit")}
          disabledReason={
            e.status !== "PUBLISHED"
              ? "非公開（下書き）の人材はマッチングを実行できません。「公開する」と実行できるようになります"
              : undefined
          }
        />
      )}
    </div>
  );
}

// 経験期間の表示。0（取込時の期間不明）は "-"、1年未満は「Nヶ月」、ちょうどN年は「N年」
function formatMonths(months: number): string {
  if (months <= 0) return "-";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest}ヶ月`;
  if (rest === 0) return `${years}年`;
  return `${years}年${rest}ヶ月`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
