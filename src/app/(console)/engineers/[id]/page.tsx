import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { getEngineer } from "@/server/services/engineers";
import { hasPermission } from "@/server/auth/rbac";
import { DeleteResourceButton } from "@/components/DeleteResourceButton";
import {
  AFFILIATION_LABELS,
  PUBLISH_STATUS_LABELS,
  REMOTE_LEVEL_LABELS,
  SKILL_CATEGORY_LABELS,
} from "@/lib/constants";
import { ActionButton } from "@/components/ActionButton";
import { MatchPanel } from "@/components/MatchPanel";
import { ConsentForm } from "@/components/ConsentForm";
import { EntryCreate } from "@/components/EntryCreate";
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

  // 他社人材: スカウト先となる自社の公開案件（§20.1）
  const scoutOptions = canScout
    ? (await listProjects(auth, "own"))
        .filter((p) => p.status === "PUBLISHED")
        .map((p) => ({ id: p.id, label: `${p.code} ${p.name}` }))
    : [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {e.code}
            {e.name && <span className="ml-2">{e.name}</span>}
            {!e.own && <span className="ml-3 rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-600">他社（匿名表示）</span>}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {e.ageBand} / {AFFILIATION_LABELS[e.affiliationType]} / {PUBLISH_STATUS_LABELS[e.status]}
          </p>
        </div>
        <div className="flex items-center gap-3">
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
                confirmText="この人材を削除しますか？（一覧・検索から除外されます。進行中のエントリーがある場合は削除できません）"
                redirectTo="/engineers"
              />
            </>
          )}
          {canPublish && e.status !== "PUBLISHED" && (
            <ActionButton path={`/api/v1/engineers/${e.id}/publish`} label="公開する" />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
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
            <Row label="在宅希望" value={REMOTE_LEVEL_LABELS[e.remotePreference]} />
            <Row
              label="最大出社"
              value={e.maxOnsiteDaysPerWeek != null ? `週${e.maxOnsiteDaysPerWeek}日` : "-"}
            />
            <Row label="工程" value={e.processes.join(", ") || "-"} />
            <Row label="役割" value={e.roles.join(", ") || "-"} />
            <Row label="業種経験" value={e.industries.join(", ") || "-"} />
            <Row label="本人同意" value={e.hasValidConsent ? "有効" : "なし"} />
          </dl>
          {e.summary && <p className="mt-4 whitespace-pre-wrap text-sm text-slate-600">{e.summary}</p>}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">スキル</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
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
                  <td className="py-1.5">{Math.floor(s.months / 12)}年{s.months % 12}ヶ月</td>
                  <td className="py-1.5">
                    {s.lastUsedAt ? new Date(s.lastUsedAt).toLocaleDateString("ja-JP") : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {canConsent && (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">本人同意の登録</h2>
          <ConsentForm engineerId={e.id} />
        </section>
      )}

      {canScout && (
        <EntryCreate type="SCOUT" fixedEngineerId={e.id} options={scoutOptions} />
      )}

      {canMatch && <MatchPanel direction="engineer-to-projects" targetId={e.id} />}
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
