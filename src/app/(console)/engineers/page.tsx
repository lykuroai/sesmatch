import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { prisma } from "@/server/db";
import { listEngineers } from "@/server/services/engineers";
import { listProjects } from "@/server/services/projects";
import { passingEngineerMatchesForProject } from "@/server/services/matching";
import { expandSearchTerms } from "@/server/services/skill-aliases";
import {
  AFFILIATION_LABELS,
  ENGINEER_WORK_STATUS_LABELS,
  isNew,
  PUBLISH_STATUS_LABELS,
  REMOTE_LEVEL_LABELS,
} from "@/lib/constants";
import { IngestPanel } from "@/components/IngestPanel";
import { PendingIngestions } from "@/components/PendingIngestions";
import { Pager, parsePage, slicePage } from "@/components/Pager";
import { NewBadge } from "@/components/NewBadge";
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
  // 対象案件選択時のマッチ条件チップ（トグル式）
  const f90 = sp.f90 === "1"; // マッチ度90%以上
  const fskill = sp.fskill === "1"; // 必須スキル一致
  const frate = sp.frate === "1"; // 単価条件一致
  const fstart = sp.fstart === "1"; // 開始日一致
  const page = parsePage(sp.page);

  // 用語辞書で検索語を同義語群（小文字化）に展開（名寄せ検索。例: 保険業務⇄保険、ポスグレ⇄PostgreSQL）
  const qTerms = q ? (await expandSearchTerms(q)).map((v) => v.toLowerCase()) : [];
  const skillTerms = new Map(
    await Promise.all(
      skills.map(async (s) => [s, (await expandSearchTerms(s)).map((v) => v.toLowerCase())] as const)
    )
  );

  const [own, pub, ownProjects, pendingJobs, processingCount] = await Promise.all([
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
    // 解析中（種別確定前なので案件/人材の区別なし）
    prisma.ingestionJob.count({
      where: { tenantCompanyId: auth.companyId, status: { in: ["RECEIVED", "MASKING", "EXTRACTING"] } },
    }),
  ]);
  const all = [...own.items, ...pub.items];
  // 対象案件が選択されていれば、その案件のハードフィルターを通過する人材に絞る
  const matches = projectId ? await passingEngineerMatchesForProject(auth, projectId) : null;
  const targetProject = projectId ? ownProjects.items.find((p) => p.id === projectId) : null;

  const startLimit =
    startWithin !== "all"
      ? new Date(new Date().setMonth(new Date().getMonth() + parseInt(startWithin)))
      : null;

  const filtered = all.filter((e) => {
    const isOwn = e.own;
    if (source === "own" && !isOwn) return false;
    if (source === "other" && isOwn) return false;
    // 下書き（非公開）は「下書き」条件でのみ表示し、紹介中などの稼働状況の条件には含めない
    const isDraft = e.own && e.status !== "PUBLISHED";
    if (ws === "DRAFT") {
      if (!isDraft) return false;
    } else if (ws !== "all") {
      if (isDraft || e.workStatus !== ws) return false;
    }
    if (matches) {
      const m = matches.get(e.id);
      if (!m) return false;
      if (f90 && m.score < 90) return false;
      if (fskill && !m.skillsOk) return false;
      if (frate && !m.rateOk) return false;
      if (fstart && !m.startOk) return false;
    }
    if (skills.length > 0) {
      // スキル名に加え工程・役割・業種も対象。指定スキルごとに同義語群のいずれかが部分一致すればよい
      const names = [
        ...e.skills.map((s) => s.name),
        ...e.processes,
        ...e.roles,
        ...e.industries,
      ].map((n) => n.toLowerCase());
      if (
        !skills.every((s) => {
          const vs = skillTerms.get(s) ?? [s.toLowerCase()];
          return names.some((n) => vs.some((v) => n.includes(v)));
        })
      )
        return false;
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
        ...e.processes,
        ...e.roles,
        ...e.industries,
      ]
        .join("\n")
        .toLowerCase();
      if (!qTerms.some((v) => haystack.includes(v))) return false;
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
    f90: f90 ? "1" : undefined,
    fskill: fskill ? "1" : undefined,
    frate: frate ? "1" : undefined,
    fstart: fstart ? "1" : undefined,
  };
  // マッチ条件チップの切替リンク（対象のフラグだけ反転し、他の条件は維持）
  const chipHref = (key: string, active: boolean) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filterParams, [key]: active ? undefined : "1" })) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `/engineers?${qs}` : "/engineers";
  };
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs ${active ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`;

  const select = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm";
  const label = "w-20 shrink-0 text-xs text-slate-600";

  // 状態バッジ（テーブル表示とモバイルのカード表示で共用）
  const statusBadges = (e: (typeof engineers)[number]) => (
    <>
      {e.own && e.status !== "PUBLISHED" && (
        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
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
    </>
  );

  return (
    <div>
      <IngestPanel
        title="人材"
        expectedKind="ENGINEER_SHEET"
        label="スキルシート・紹介メールから取込"
        hint="人材のスキルシートや紹介メールの本文を貼り付け・アップロードするだけで登録できます。"
        note="複数人材の同時取込には対応していません。1回の取込で登録できる人材は1名です。1つのファイル・貼り付けに複数名が含まれていても分割されず、先頭の1名分として抽出されることがあります。人材ごとにファイルや貼り付けを分けて取り込んでください（複数ページの書類・撮影画像を1名分としてまとめる取込は可能です）。"
        action={
          <Link
            href="/engineers/new"
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            人材を登録
          </Link>
        }
      />
      <PendingIngestions
        jobs={pendingJobs.map((j) => ({
          id: j.id,
          filename: j.sourceDocument.filename,
          createdAt: j.createdAt,
        }))}
        processingCount={processingCount}
      />

      {/* 検索条件 */}
      <form method="GET" action="/engineers" className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <span className={label}>キーワード</span>
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="人材名・ID・スキル・業務内容"
            className={`${select} min-w-0 w-full max-w-96`}
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
              <option value="NEGOTIATING">商談中</option>
              <option value="CONTRACTED">成約</option>
              <option value="WORKING">稼働中</option>
              <option value="DRAFT">下書き</option>
              <option value="all">すべて</option>
            </select>
          </span>
          <span className="flex min-w-0 max-w-full items-center gap-2">
            <span className={label}>対象案件</span>
            {/* 案件名が長いとセレクトが画面幅を超えるため、モバイルでは縮めて省略表示 */}
            <select name="projectId" defaultValue={projectId} className={`${select} min-w-0 max-w-full`}>
              <option value="">指定なし</option>
              {/* 下書き（非公開）・成約・終了の案件は対象にしない（マッチング候補と同じ仕様） */}
              {ownProjects.items
                .filter((p) => p.status === "PUBLISHED" && !["CONTRACTED", "ENDED"].includes(p.workflowStatus))
                .map((p) => (
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

      {/* 対象案件選択時: 対象の表示とマッチ条件チップ */}
      {targetProject && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-purple-200 bg-purple-50 px-4 py-2.5">
          <span className="text-sm font-medium text-purple-900">
            対象案件：{targetProject.code} {targetProject.name}
          </span>
          <Link href={chipHref("f90", f90)} className={chip(f90)}>マッチ度90%以上</Link>
          <Link href={chipHref("fskill", fskill)} className={chip(fskill)}>必須スキル一致</Link>
          <Link href={chipHref("frate", frate)} className={chip(frate)}>単価条件一致</Link>
          <Link href={chipHref("fstart", fstart)} className={chip(fstart)}>開始日一致</Link>
        </div>
      )}

      <p className="mb-3 text-xs text-slate-500">{filtered.length}件が該当</p>

      {/* モバイル: カード表示（md 未満） */}
      <div className="space-y-3 md:hidden">
        {engineers.map((e) => (
          <Link
            key={e.id}
            href={`/engineers/${e.id}`}
            className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm active:bg-slate-50"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-blue-700">
                {e.code}
                {e.name ? ` ${e.name}` : ""}
              </span>
              {isNew(e.createdAt) && (
                <NewBadge />
              )}
              <span className={`rounded px-1.5 py-0.5 text-xs ${e.own ? "bg-purple-50 text-purple-700" : "bg-slate-100 text-slate-600"}`}>
                {e.own ? "自社" : "他社"}
              </span>
              {statusBadges(e)}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {e.ageBand} ／ {AFFILIATION_LABELS[e.affiliationType]} ／ 単価帯 {e.rateBand} ／{" "}
              {REMOTE_LEVEL_LABELS[e.remotePreference]}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              稼働可能日 {e.availableFrom ? new Date(e.availableFrom).toLocaleDateString("ja-JP") : "-"} ／ 同意{" "}
              {e.hasValidConsent ? "〇" : <span className="text-red-600">なし</span>}
            </p>
          </Link>
        ))}
        {engineers.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400 shadow-sm">
            該当する人材がありません
          </div>
        )}
      </div>

      {/* PC: テーブル表示 */}
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
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
                <td className="whitespace-nowrap px-4 py-3">
                  <Link href={`/engineers/${e.id}`} className="font-medium text-blue-700 hover:underline">
                    {e.code}
                    {e.name ? ` ${e.name}` : ""}
                  </Link>
                  {isNew(e.createdAt) && (
                    <NewBadge className="ml-1.5" />
                  )}
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
                  <span className="flex items-center gap-1.5">{statusBadges(e)}</span>
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
