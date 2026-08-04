// 双方向マッチングサービス（§19）
// 案件→人材 / 人材→案件。自社データを起点に、公開済みデータ全体から候補を探す。

import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/auth/session";
import { score, type EngineerForMatch, type ProjectForMatch } from "@/server/matching/engine";
import { hasValidConsent, isForeignNationality, serializeEngineer } from "./engineers";
import { serializeProject } from "./projects";
import type { Engineer, EngineerSkill, PersonConsent, Project, ProjectSkill } from "@prisma/client";

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
  };
}

// 案件→人材（自社案件に対する候補人材を全公開人材から探す）
export async function matchProjectToEngineers(auth: AuthContext, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, tenantCompanyId: auth.companyId },
    include: { skills: true },
  });
  if (!project) return null;

  const candidates = await prisma.engineer.findMany({
    where: { deletedAt: null, OR: [{ status: "PUBLISHED" }, { tenantCompanyId: auth.companyId }] },
    include: { skills: true, consents: true },
  });

  const pm = toProjectForMatch(project);
  // 自社案件は公開前でもマッチング計算対象にする
  const pmForCalc = { ...pm, status: "PUBLISHED" };

  const results = candidates
    .map((e) => ({
      engineer: serializeEngineer(e, auth),
      result: score(pmForCalc, toEngineerForMatch(e)),
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

// 人材→案件（自社人材に合う案件を全公開案件から探す）
export async function matchEngineerToProjects(auth: AuthContext, engineerId: string) {
  const engineer = await prisma.engineer.findFirst({
    where: { id: engineerId, tenantCompanyId: auth.companyId, deletedAt: null },
    include: { skills: true, consents: true },
  });
  if (!engineer) return null;

  const projects = await prisma.project.findMany({
    where: { OR: [{ status: "PUBLISHED" }, { tenantCompanyId: auth.companyId }] },
    include: { skills: true },
  });

  const em = toEngineerForMatch(engineer);
  // 自社人材は公開前でも計算対象（公開可否は同意チェックで別途担保）
  const emForCalc = { ...em, status: "PUBLISHED" };

  const results = projects
    .map((p) => ({
      project: serializeProject(p, auth),
      result: score(toProjectForMatch(p), emForCalc),
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
