// 双方向マッチングサービス（§19）
// 案件→人材 / 人材→案件。自社データを起点に、公開済みデータ全体から候補を探す。

import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/auth/session";
import { score, type EngineerForMatch, type ProjectForMatch } from "@/server/matching/engine";
import { normalizeSkillTerm } from "@/lib/constants";
import { hasValidConsent, isForeignNationality, serializeEngineer } from "./engineers";
import { serializeProject } from "./projects";
import type { Engineer, EngineerSkill, PersonConsent, Project, ProjectSkill } from "@prisma/client";

// 用語辞書（承認済みのみ）を読み込んだ名寄せ関数を作る（§19）。
// 表記→正規形の引き当ての前後に接尾辞正規化（normalizeSkillTerm）を適用する。
// マッチング実行時に辞書をLLMへ問い合わせることはない（辞書の候補提案のみLLMを使う設計）
async function buildTermNormalizer(): Promise<(name: string) => string> {
  const aliases = await prisma.skillAlias.findMany({ where: { status: "APPROVED" } });
  const map = new Map(
    aliases.map((a) => [normalizeSkillTerm(a.alias), normalizeSkillTerm(a.canonical)])
  );
  return (name) => {
    const base = normalizeSkillTerm(name);
    return map.get(base) ?? base;
  };
}

function toEngineerForMatch(e: Engineer & { skills: EngineerSkill[]; consents: PersonConsent[] }): EngineerForMatch {
  return {
    id: e.id,
    tenantCompanyId: e.tenantCompanyId,
    status: e.status,
    affiliationType: e.affiliationType,
    availableFrom: e.availableFrom,
    desiredRateYen: e.desiredRateYen,
    maxOnsiteDaysPerWeek: e.maxOnsiteDaysPerWeek,
    remotePreference: e.remotePreference,
    workAuthStatus: e.workAuthStatus,
    foreignNational: isForeignNationality(e.nationality),
    hasValidConsent: hasValidConsent(e.consents),
    skills: e.skills.map((s) => ({ name: s.name, months: s.months, lastUsedAt: s.lastUsedAt })),
    processes: e.processes,
    roles: e.roles,
    industries: e.industries,
    residenceCity: e.residenceCity,
  };
}

function toProjectForMatch(p: Project & { skills: ProjectSkill[] }): ProjectForMatch {
  return {
    id: p.id,
    tenantCompanyId: p.tenantCompanyId,
    status: p.status,
    startDate: p.startDate,
    rateMaxYen: p.rateMaxYen,
    onsiteDaysPerWeek: p.onsiteDaysPerWeek,
    remoteLevel: p.remoteLevel,
    allowSubtier: p.allowSubtier,
    noForeignNational: p.noForeignNational,
    acceptedTypes: p.acceptedTypes,
    industry: p.industry,
    processes: p.processes,
    requiredSkills: p.skills.filter((s) => s.required).map((s) => ({ name: s.name, minMonths: s.minMonths })),
    preferredSkills: p.skills.filter((s) => !s.required).map((s) => ({ name: s.name })),
    locationCity: p.locationCity,
  };
}

// マッチング実行時の画面条件（必須スキル充足率のしきい値。既定1=全て充足）
export type MatchRunOptions = { minRequiredSkillRatio?: number };

// 案件→人材（自社案件に対する候補人材を全公開人材から探す）
export async function matchProjectToEngineers(
  auth: AuthContext,
  projectId: string,
  runOpts?: MatchRunOptions
) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, tenantCompanyId: auth.companyId },
    include: { skills: true },
  });
  if (!project) return null;

  const candidates = await prisma.engineer.findMany({
    where: {
      deletedAt: null,
      // 成約・稼働中の人材は新たなマッチング候補にしない
      workStatus: { notIn: ["CONTRACTED", "WORKING"] },
      OR: [{ status: "PUBLISHED" }, { tenantCompanyId: auth.companyId }],
    },
    include: { skills: true, consents: true },
  });

  const pm = toProjectForMatch(project);
  // 自社案件は公開前でもマッチング計算対象にする
  const pmForCalc = { ...pm, status: "PUBLISHED" };
  const normalize = await buildTermNormalizer();

  const results = candidates
    .map((e) => ({
      engineer: serializeEngineer(e, auth),
      result: score(pmForCalc, toEngineerForMatch(e), {
        normalize,
        minRequiredSkillRatio: runOpts?.minRequiredSkillRatio,
      }),
    }))
    .filter((r) => r.result.passed)
    .sort((a, b) => b.result.score - a.result.score);

  await prisma.matchingResult.createMany({
    data: results.map((r) => ({
      tenantCompanyId: auth.companyId,
      direction: "PROJECT_TO_ENGINEERS",
      projectId,
      engineerId: r.engineer.id,
      passed: r.result.passed,
      score: r.result.score,
      breakdown: r.result.breakdown,
      matchedConditions: r.result.matchedConditions,
      missingConditions: r.result.missingConditions,
      warnings: r.result.warnings,
    })),
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "MatchCalculated",
    targetType: "Project",
    targetId: projectId,
    metadata: { direction: "PROJECT_TO_ENGINEERS", candidates: results.length },
  });

  return { project: serializeProject(project, auth), results };
}

// 検索フィルター用のマッチ結果概要（マッチ度・一致条件チップの判定に使う）
export type MatchSummary = {
  score: number;
  rateOk: boolean; // 希望単価が案件上限内
  startOk: boolean; // 稼働開始日が案件開始に適合
  skillsOk: boolean; // 必須スキルを全て充足
  remoteOk: boolean; // 案件の出社条件が人材の許容範囲内
};

function toSummary(r: ReturnType<typeof score>): MatchSummary {
  return {
    score: r.score,
    rateOk: r.matchedConditions.includes("希望単価が案件上限内"),
    startOk: r.matchedConditions.includes("稼働開始日が案件開始に適合"),
    skillsOk: r.matchedConditions.includes("必須スキルを全て充足"),
    remoteOk: (r.breakdown["通勤・在宅"] ?? 0) >= 10,
  };
}

// 人材検索の「対象案件」フィルター用: 指定した自社案件のハードフィルターを通過する
// 人材ID→マッチ結果概要の Map を返す（検索のたびに呼ばれるため、結果の保存・監査記録は行わない）
export async function passingEngineerMatchesForProject(
  auth: AuthContext,
  projectId: string
): Promise<Map<string, MatchSummary> | null> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, tenantCompanyId: auth.companyId },
    include: { skills: true },
  });
  if (!project) return null;
  const candidates = await prisma.engineer.findMany({
    where: {
      deletedAt: null,
      // 成約・稼働中の人材は新たなマッチング候補にしない
      workStatus: { notIn: ["CONTRACTED", "WORKING"] },
      OR: [{ status: "PUBLISHED" }, { tenantCompanyId: auth.companyId }],
    },
    include: { skills: true, consents: true },
  });
  // 自社案件は公開前でも計算対象（matchProjectToEngineers と同じ扱い）
  const pm = { ...toProjectForMatch(project), status: "PUBLISHED" };
  const normalize = await buildTermNormalizer();
  const map = new Map<string, MatchSummary>();
  for (const e of candidates) {
    const r = score(pm, toEngineerForMatch(e), { normalize });
    if (r.passed) map.set(e.id, toSummary(r));
  }
  return map;
}

// 案件検索の「対象人材」フィルター用: 指定した自社人材がハードフィルターを通過する
// 案件ID→マッチ結果概要の Map を返す（検索のたびに呼ばれるため、結果の保存・監査記録は行わない）
export async function passingProjectMatchesForEngineer(
  auth: AuthContext,
  engineerId: string
): Promise<Map<string, MatchSummary> | null> {
  const engineer = await prisma.engineer.findFirst({
    where: { id: engineerId, tenantCompanyId: auth.companyId, deletedAt: null },
    include: { skills: true, consents: true },
  });
  if (!engineer) return null;
  const projects = await prisma.project.findMany({
    where: {
      // 終了・成約した案件はマッチング候補にしない
      workflowStatus: { notIn: ["ENDED", "CONTRACTED"] },
      OR: [{ status: "PUBLISHED" }, { tenantCompanyId: auth.companyId }],
    },
    include: { skills: true },
  });
  // 自社人材は公開前でも計算対象（matchEngineerToProjects と同じ扱い）
  const em = { ...toEngineerForMatch(engineer), status: "PUBLISHED" };
  const normalize = await buildTermNormalizer();
  const map = new Map<string, MatchSummary>();
  for (const p of projects) {
    const r = score(toProjectForMatch(p), em, { normalize });
    if (r.passed) map.set(p.id, toSummary(r));
  }
  return map;
}

// 人材→案件（自社人材に合う案件を全公開案件から探す）
export async function matchEngineerToProjects(
  auth: AuthContext,
  engineerId: string,
  runOpts?: MatchRunOptions
) {
  const engineer = await prisma.engineer.findFirst({
    where: { id: engineerId, tenantCompanyId: auth.companyId, deletedAt: null },
    include: { skills: true, consents: true },
  });
  if (!engineer) return null;

  const projects = await prisma.project.findMany({
    where: {
      // 終了・成約した案件はマッチング候補にしない
      workflowStatus: { notIn: ["ENDED", "CONTRACTED"] },
      OR: [{ status: "PUBLISHED" }, { tenantCompanyId: auth.companyId }],
    },
    include: { skills: true },
  });

  const em = toEngineerForMatch(engineer);
  // 自社人材は公開前でも計算対象（公開可否は同意チェックで別途担保）
  const emForCalc = { ...em, status: "PUBLISHED" };
  const normalize = await buildTermNormalizer();

  const results = projects
    .map((p) => ({
      project: serializeProject(p, auth),
      result: score(toProjectForMatch(p), emForCalc, {
        normalize,
        minRequiredSkillRatio: runOpts?.minRequiredSkillRatio,
      }),
    }))
    .filter((r) => r.result.passed)
    .sort((a, b) => b.result.score - a.result.score);

  await prisma.matchingResult.createMany({
    data: results.map((r) => ({
      tenantCompanyId: auth.companyId,
      direction: "ENGINEER_TO_PROJECTS",
      projectId: r.project.id,
      engineerId,
      passed: r.result.passed,
      score: r.result.score,
      breakdown: r.result.breakdown,
      matchedConditions: r.result.matchedConditions,
      missingConditions: r.result.missingConditions,
      warnings: r.result.warnings,
    })),
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "MatchCalculated",
    targetType: "Engineer",
    targetId: engineerId,
    metadata: { direction: "ENGINEER_TO_PROJECTS", candidates: results.length },
  });

  return { engineer: serializeEngineer(engineer, auth), results };
}
