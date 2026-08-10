import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { prisma } from "@/server/db";
import { listProjects } from "@/server/services/projects";
import { listEngineers } from "@/server/services/engineers";
import { passingProjectMatchesForEngineer } from "@/server/services/matching";
import { PROJECT_WORKFLOW_LABELS, PUBLISH_STATUS_LABELS, REMOTE_LEVEL_LABELS } from "@/lib/constants";
import { IngestPanel } from "@/components/IngestPanel";
import { PendingIngestions } from "@/components/PendingIngestions";
import { Pager, parsePage, slicePage } from "@/components/Pager";
import { SkillChipsInput } from "@/components/SkillChipsInput";

const START_WITHIN_OPTIONS: [string, string][] = [
  ["1", "1か月以内"],
  ["3", "3か月以内"],
  ["6", "6か月以内"],
];

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const source = sp.source ?? "all"; // all | own | other（掲載元）
  const wf = sp.wf ?? "RECRUITING"; // 案件状況（既定: 募集中）
  const engineerId = sp.engineerId ?? ""; // 対象人材（自社人材）
  const skills = (sp.skills ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const rateMin = sp.rateMin ? parseInt(sp.rateMin) : null; // 万円
  const rateMax = sp.rateMax ? parseInt(sp.rateMax) : null;
  const remote = sp.remote ?? "all";
  const location = sp.location ?? "all";
  const startWithin = sp.start ?? "all"; // 開始時期（か月以内）
  // 対象人材選択時のマッチ条件チップ（トグル式）
  const f90 = sp.f90 === "1"; // マッチ度90%以上
  const frate = sp.frate === "1"; // 単価条件一致
  const fremote = sp.fremote === "1"; // リモート可（出社条件が人材の許容内）
  const fstart = sp.fstart === "1"; // 開始日一致
  const page = parsePage(sp.page);

  const [own, pub, engineers, pendingJobs] = await Promise.all([
    listProjects(auth, "own"),
    listProjects(auth, "public"),
    listEngineers(auth, "own"),
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
  const all = [...own.items, ...pub.items];
  // 対象人材が選択されていれば、その人材がハードフィルターを通過する案件に絞る
  const matches = engineerId ? await passingProjectMatchesForEngineer(auth, engineerId) : null;
  const targetEngineer = engineerId ? engineers.items.find((e) => e.id === engineerId) : null;

  const startLimit =
    startWithin !== "all"
      ? new Date(new Date().setMonth(new Date().getMonth() + parseInt(startWithin)))
      : null;

  const filtered = all.filter((p) => {
    if (source === "own" && !p.own) return false;
    if (source === "other" && p.own) return false;
    if (wf !== "all" && p.workflowStatus !== wf) return false;
    if (matches) {
      const m = matches.get(p.id);
      if (!m) return false;
      if (f90 && m.score < 90) return false;
      if (frate && !m.rateOk) return false;
      if (fremote && !m.remoteOk) return false;
      if (fstart && !m.startOk) return false;
    }
    if (skills.length > 0) {
      const names = [...p.requiredSkills, ...p.preferredSkills].map((s) => s.name.toLowerCase());
      if (!skills.every((s) => names.some((n) => n.includes(s.toLowerCase())))) return false;
    }
    // 単価: 案件の単価帯（下限〜上限）と指定範囲が重なるか
    if (rateMin && p.rateMaxYen < rateMin * 10_000) return false;
    if (rateMax && (p.rateMinYen ?? 0) > rateMax * 10_000) return false;
    if (remote !== "all" && p.remoteLevel !== remote) return false;
    if (location !== "all" && p.locationCity !== location) return false;
    if (startLimit && new Date(p.startDate) > startLimit) return false;
    if (q) {
      const haystack = [
        p.code,
        p.name,
        p.anonymousSummary,
        ...p.requiredSkills.map((s) => s.name),
        ...p.preferredSkills.map((s) => s.name),
      ]
        .join("\n")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  const projects = slicePage(filtered, page);

  // 勤務地の選択肢は登録済み案件の勤務地から生成
  const locations = [...new Set(all.map((p) => p.locationCity).filter(Boolean))].sort() as string[];

  const advancedUsed =
    skills.length > 0 || rateMin != null || rateMax != null || remote !== "all" || location !== "all" || startWithin !== "all";
  const filterParams: Record<string, string | undefined> = {
    q: sp.q || undefined,
    source: source !== "all" ? source : undefined,
    wf: wf !== "RECRUITING" ? wf : undefined,
    engineerId: engineerId || undefined,
    skills: skills.length > 0 ? skills.join(",") : undefined,
    rateMin: sp.rateMin || undefined,
    rateMax: sp.rateMax || undefined,
    remote: remote !== "all" ? remote : undefined,
    location: location !== "all" ? location : undefined,
    start: startWithin !== "all" ? startWithin : undefined,
    f90: f90 ? "1" : undefined,
    frate: frate ? "1" : undefined,
    fremote: fremote ? "1" : undefined,
    fstart: fstart ? "1" : undefined,
  };
  // マッチ条件チップの切替リンク（対象のフラグだけ反転し、他の条件は維持）
  const chipHref = (key: string, active: boolean) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filterParams, [key]: active ? undefined : "1" })) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `/projects?${qs}` : "/projects";
  };
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs ${active ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`;

  const select = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm";
  const label = "w-20 shrink-0 text-xs text-slate-600";

  return (
    <div>
      <IngestPanel
        title="案件"
        label="案件票・紹介メールから取込"
        hint="案件票や紹介メールの本文を貼り付け・アップロードするだけで登録できます。"
        action={
          <Link
            href="/projects/new"
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            案件を登録
          </Link>
        }
      />
      <PendingIngestions
        jobs={pendingJobs.map((j) => ({
          id: j.id,
          filename: j.sourceDocument.filename,
          createdAt: j.createdAt,
        }))}
      />

      {/* 検索条件 */}
      <form method="GET" action="/projects" className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <span className={label}>キーワード</span>
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="案件名・ID・スキル・業務内容"
            className={`${select} w-96`}
          />
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="flex items-center gap-2">
            <span className={label}>掲載元</span>
            <select name="source" defaultValue={source} className={select}>
              <option value="all">すべて</option>
              <option value="own">自社案件</option>
              <option value="other">他社案件</option>
            </select>
          </span>
          <span className="flex items-center gap-2">
            <span className={label}>案件状況</span>
            <select name="wf" defaultValue={wf} className={select}>
              <option value="RECRUITING">募集中</option>
              <option value="CONTRACTED">成約</option>
              <option value="ENDED">終了</option>
              <option value="all">すべて</option>
            </select>
          </span>
          <span className="flex items-center gap-2">
            <span className={label}>対象人材</span>
            <select name="engineerId" defaultValue={engineerId} className={select}>
              <option value="">指定なし</option>
              {engineers.items.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.code}
                  {e.name ? ` ${e.name}` : ""}
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
                <span className={label}>開始時期</span>
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
          <Link href="/projects" className="rounded border border-slate-300 bg-white px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
            条件をクリア
          </Link>
        </div>
      </form>

      {/* 対象人材選択時: 対象の表示とマッチ条件チップ */}
      {targetEngineer && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5">
          <span className="text-sm font-medium text-blue-900">
            対象人材：{targetEngineer.code}
            {targetEngineer.name ? ` ${targetEngineer.name}` : ""}
          </span>
          <Link href={chipHref("f90", f90)} className={chip(f90)}>マッチ度90%以上</Link>
          <Link href={chipHref("frate", frate)} className={chip(frate)}>単価条件一致</Link>
          <Link href={chipHref("fremote", fremote)} className={chip(fremote)}>リモート可</Link>
          <Link href={chipHref("fstart", fstart)} className={chip(fstart)}>開始日一致</Link>
        </div>
      )}

      <p className="mb-3 text-xs text-slate-500">{filtered.length}件が該当</p>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="whitespace-nowrap px-4 py-3">案件ID</th>
              <th className="whitespace-nowrap px-4 py-3">掲載元</th>
              <th className="px-4 py-3">案件名</th>
              <th className="whitespace-nowrap px-4 py-3">開始日</th>
              <th className="whitespace-nowrap px-4 py-3">単価上限</th>
              <th className="whitespace-nowrap px-4 py-3">出社/在宅</th>
              <th className="px-4 py-3">必須スキル</th>
              <th className="whitespace-nowrap px-4 py-3">状態</th>
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
                <td className="whitespace-nowrap px-4 py-3">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${p.own ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                    {p.own ? "自社" : "他社"}
                  </span>
                </td>
                {/* 長い案件名は改行せず1行で省略表示（全文はツールチップ） */}
                <td className="max-w-72 truncate px-4 py-3" title={p.name}>{p.name}</td>
                <td className="whitespace-nowrap px-4 py-3">{new Date(p.startDate).toLocaleDateString("ja-JP")}</td>
                <td className="whitespace-nowrap px-4 py-3">{(p.rateMaxYen / 10_000).toLocaleString()}万円</td>
                <td className="whitespace-nowrap px-4 py-3 text-xs">{REMOTE_LEVEL_LABELS[p.remoteLevel]}</td>
                <td className="px-4 py-3 text-xs">{p.requiredSkills.map((s) => s.name).join(", ")}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  {p.own && p.status !== "PUBLISHED" && (
                    <span className="mr-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
                      {PUBLISH_STATUS_LABELS[p.status]}
                    </span>
                  )}
                  {/* 未公開の案件は応募を受けられないため「応募中」は表示しない */}
                  {(p.status === "PUBLISHED" || p.workflowStatus !== "RECRUITING") && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
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
                </td>
              </tr>
            ))}
            {projects.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  該当する案件がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager total={filtered.length} page={page} basePath="/projects" params={filterParams} />
    </div>
  );
}
