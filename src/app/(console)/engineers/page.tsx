import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { prisma } from "@/server/db";
import { listEngineers } from "@/server/services/engineers";
import { listProjects } from "@/server/services/projects";
import { passingEngineerIdsForProject } from "@/server/services/matching";
import {
  AFFILIATION_LABELS,
  ENGINEER_WORK_STATUS_LABELS,
  PUBLISH_STATUS_LABELS,
  REMOTE_LEVEL_LABELS,
} from "@/lib/constants";
import { IngestPanel } from "@/components/IngestPanel";
import { PendingIngestions } from "@/components/PendingIngestions";
import { Pager, parsePage, slicePage } from "@/components/Pager";
import { SkillChipsInput } from "@/components/SkillChipsInput";

const START_WITHIN_OPTIONS: [string, string][] = [
  ["1", "1か月以内"],
  ["3", "3か月以内"],
  ["6", "6か月以内"],
];

// Level 1 の単価帯表示（"60〜70万円"）から下限（万円）を取り出す。
// 実額単価そのものでは絞り込まない（10万円幅の帯単位で判定 §10）
function rateBandLowerMan(band: string): number {
  return parseInt(band) || 0;
}

export default async function EngineersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const source = sp.source ?? "all"; // all | own | other（掲載元）
  const ws = sp.ws ?? "PROPOSING"; // 稼働状況（既定: 紹介中）
  const projectId = sp.projectId ?? ""; // 対象案件（自社案件）
  const skills = (sp.skills ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const rateMin = sp.rateMin ? parseInt(sp.rateMin) : null; // 万円
  const rateMax = sp.rateMax ? parseInt(sp.rateMax) : null;
  const remote = sp.remote ?? "all";
  const location = sp.location ?? "all";
  const startWithin = sp.start ?? "all"; // 稼働可能時期（か月以内）
  const page = parsePage(sp.page);

  const [own, pub, ownProjects, pendingJobs] = await Promise.all([
    listEngineers(auth, "own"),
    listEngineers(auth, "public"),
    listProjects(auth, "own"),
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
  const all = [...own.items, ...pub.items];
  // 対象案件が選択されていれば、その案件のハードフィルターを通過する人材に絞る
  const matchIds = projectId ? await passingEngineerIdsForProject(auth, projectId) : null;

  const startLimit =
    startWithin !== "all"
      ? new Date(new Date().setMonth(new Date().getMonth() + parseInt(startWithin)))
      : null;

  const filtered = all.filter((e) => {
    const isOwn = e.own;
    if (source === "own" && !isOwn) return false;
    if (source === "other" && isOwn) return false;
    if (ws !== "all" && e.workStatus !== ws) return false;
    if (matchIds && !matchIds.has(e.id)) return false;
    if (skills.length > 0) {
      const names = e.skills.map((s) => s.name.toLowerCase());
      if (!skills.every((s) => names.some((n) => n.includes(s.toLowerCase())))) return false;
    }
    // 単価: Level 1 の単価帯（10万円幅）と指定範囲が重なるか
    const bandLower = rateBandLowerMan(e.rateBand);
    if (rateMin && bandLower + 10 < rateMin) return false;
    if (rateMax && bandLower > rateMax) return false;
    if (remote !== "all" && e.remotePreference !== remote) return false;
    if (location !== "all" && e.residenceCity !== location) return false;
    // 稼働可能時期: 稼働可能日が期限内（未設定は「いつでも」とみなし含める）
    if (startLimit && e.availableFrom && new Date(e.availableFrom) > startLimit) return false;
    if (q) {
      const haystack = [
        e.code,
        e.name ?? "",
        e.summary ?? "",
        e.residenceCity ?? "",
        ...e.skills.map((s) => s.name),
      ]
        .join("\n")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  const engineers = slicePage(filtered, page);

  // 勤務地の選択肢は登録済み人材の居住エリアから生成
  const locations = [...new Set(all.map((e) => e.residenceCity).filter(Boolean))].sort() as string[];

  const advancedUsed =
    skills.length > 0 || rateMin != null || rateMax != null || remote !== "all" || location !== "all" || startWithin !== "all";
  const filterParams: Record<string, string | undefined> = {
    q: sp.q || undefined,
    source: source !== "all" ? source : undefined,
    ws: ws !== "PROPOSING" ? ws : undefined,
    projectId: projectId || undefined,
    skills: skills.length > 0 ? skills.join(",") : undefined,
    rateMin: sp.rateMin || undefined,
    rateMax: sp.rateMax || undefined,
    remote: remote !== "all" ? remote : undefined,
    location: location !== "all" ? location : undefined,
    start: startWithin !== "all" ? startWithin : undefined,
  };

  const select = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm";
  const label = "w-20 shrink-0 text-xs text-slate-600";

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

      {/* 検索条件 */}
      <form method="GET" action="/engineers" className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <span className={label}>キーワード</span>
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="人材名・ID・スキル・業務内容"
            className={`${select} w-96`}
          />
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="flex items-center gap-2">
            <span className={label}>掲載元</span>
            <select name="source" defaultValue={source} className={select}>
              <option value="all">すべて</option>
              <option value="own">自社人材</option>
              <option value="other">他社人材</option>
            </select>
          </span>
          <span className="flex items-center gap-2">
            <span className={label}>稼働状況</span>
            <select name="ws" defaultValue={ws} className={select}>
              <option value="PROPOSING">紹介中</option>
              <option value="WORKING">稼働中</option>
              <option value="all">すべて</option>
            </select>
          </span>
          <span className="flex items-center gap-2">
            <span className={label}>対象案件</span>
            <select name="projectId" defaultValue={projectId} className={select}>
              <option value="">指定なし</option>
              {ownProjects.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} {p.name}
                </option>
              ))}
            </select>
          </span>
        </div>

        {/* 詳細条件（いずれかが指定されていれば開いた状態にする） */}
        <details open={advancedUsed} className="mb-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-600 hover:text-slate-800">
            詳細条件
          </summary>
          <div className="mt-3 space-y-3">
            <div className="flex items-start gap-2">
              <span className={`${label} pt-1.5`}>必須スキル</span>
              <SkillChipsInput name="skills" initial={skills} />
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <span className="flex items-center gap-2">
                <span className={label}>単価</span>
                <input type="number" name="rateMin" min={0} defaultValue={sp.rateMin ?? ""} className={`${select} w-20`} />
                <span className="text-xs text-slate-500">万円 〜</span>
                <input type="number" name="rateMax" min={0} defaultValue={sp.rateMax ?? ""} className={`${select} w-20`} />
                <span className="text-xs text-slate-500">万円</span>
              </span>
              <span className="flex items-center gap-2">
                <span className={label}>勤務形態</span>
                <select name="remote" defaultValue={remote} className={select}>
                  <option value="all">すべて</option>
                  {Object.entries(REMOTE_LEVEL_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </span>
              <span className="flex items-center gap-2">
                <span className={label}>勤務地</span>
                <select name="location" defaultValue={location} className={select}>
                  <option value="all">すべて</option>
                  {locations.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </span>
              <span className="flex items-center gap-2">
                <span className={label}>稼働時期</span>
                <select name="start" defaultValue={startWithin} className={select}>
                  <option value="all">すべて</option>
                  {START_WITHIN_OPTIONS.map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </span>
            </div>
          </div>
        </details>

        <div className="flex gap-2">
          <button type="submit" className="rounded bg-slate-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
            検索
          </button>
          <Link href="/engineers" className="rounded border border-slate-300 bg-white px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
            条件をクリア
          </Link>
        </div>
      </form>

      <p className="mb-3 text-xs text-slate-500">{filtered.length}件が該当</p>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">人材ID</th>
              <th className="px-4 py-3">掲載元</th>
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
                <td className="px-4 py-3">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${e.own ? "bg-purple-50 text-purple-700" : "bg-slate-100 text-slate-600"}`}>
                    {e.own ? "自社" : "他社"}
                  </span>
                </td>
                <td className="px-4 py-3">{e.ageBand}</td>
                <td className="px-4 py-3">{AFFILIATION_LABELS[e.affiliationType]}</td>
                <td className="px-4 py-3">{e.rateBand}</td>
                <td className="px-4 py-3">
                  {e.availableFrom ? new Date(e.availableFrom).toLocaleDateString("ja-JP") : "-"}
                </td>
                <td className="px-4 py-3 text-xs">{REMOTE_LEVEL_LABELS[e.remotePreference]}</td>
                <td className="px-4 py-3">
                  {e.own && e.status !== "PUBLISHED" && (
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
                <td className="px-4 py-3">{e.hasValidConsent ? "〇" : <span className="text-red-600">なし</span>}</td>
              </tr>
            ))}
            {engineers.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  該当する人材がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager total={filtered.length} page={page} basePath="/engineers" params={filterParams} />
    </div>
  );
}
