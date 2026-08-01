import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/auth/session";
import type { Project, ProjectSkill } from "@prisma/client";

type ProjectWithRels = Project & { skills: ProjectSkill[] };

export function serializeProject(p: ProjectWithRels, auth: AuthContext) {
  const own = p.tenantCompanyId === auth.companyId;
  return {
    id: p.id,
    code: p.code,
    own,
    name: p.name,
    anonymousSummary: p.anonymousSummary,
    industry: p.industry,
    headcount: p.headcount,
    startDate: p.startDate,
    endDate: p.endDate,
    longTerm: p.longTerm,
    locationCity: p.locationCity,
    nearestStation: p.nearestStation,
    onsiteDaysPerWeek: p.onsiteDaysPerWeek,
    remoteLevel: p.remoteLevel,
    // 単価帯は Level 1 でも表示可（§10）。MVP では上限額を帯表示せずそのまま返す。
    rateMinYen: p.rateMinYen,
    rateMaxYen: p.rateMaxYen,
    contractType: p.contractType,
    allowSubtier: p.allowSubtier,
    acceptedTypes: p.acceptedTypes,
    interviewCount: p.interviewCount,
    processes: p.processes,
    status: p.status,
    workflowStatus: p.workflowStatus,
    requiredSkills: p.skills.filter((s) => s.required).map((s) => ({ name: s.name, minMonths: s.minMonths })),
    preferredSkills: p.skills.filter((s) => !s.required).map((s) => ({ name: s.name })),
    maskedSourceText: own ? p.maskedSourceText : undefined, // 取込時の匿名化済み原文（自社のみ）
  };
}

export async function listProjects(auth: AuthContext, scope: "own" | "public", query?: string) {
  const base =
    scope === "own"
      ? { tenantCompanyId: auth.companyId }
      : { status: "PUBLISHED" as const, NOT: { tenantCompanyId: auth.companyId } };
  // キーワード検索: 案件名・コード・匿名概要・スキル名・勤務地・業種・工程
  const q = query?.trim();
  const search = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { code: { contains: q, mode: "insensitive" as const } },
          { anonymousSummary: { contains: q, mode: "insensitive" as const } },
          { locationCity: { contains: q, mode: "insensitive" as const } },
          { industry: { contains: q, mode: "insensitive" as const } },
          { processes: { has: q } },
          { skills: { some: { name: { contains: q, mode: "insensitive" as const } } } },
        ],
      }
    : {};
  const projects = await prisma.project.findMany({
    where: { ...base, ...search },
    include: { skills: true },
    orderBy: { createdAt: "desc" },
  });
  return projects.map((p) => serializeProject(p, auth));
}

export async function getProject(auth: AuthContext, id: string) {
  const p = await prisma.project.findUnique({ where: { id }, include: { skills: true } });
  if (!p) return null;
  if (p.tenantCompanyId !== auth.companyId && p.status !== "PUBLISHED") return null; // §29
  return serializeProject(p, auth);
}

export type ProjectInput = {
  name: string;
  anonymousSummary: string;
  industry?: string;
  headcount?: number;
  startDate: string;
  endDate?: string;
  longTerm?: boolean;
  locationCity?: string;
  nearestStation?: string;
  onsiteDaysPerWeek?: number;
  remoteLevel?: "R0" | "R1" | "R2" | "R3" | "R4" | "R5";
  rateMinYen?: number;
  rateMaxYen: number;
  contractType?: string;
  allowSubtier?: boolean;
  acceptedTypes?: ("EMPLOYEE" | "AFFILIATED" | "FREELANCER" | "SUBTIER1")[];
  interviewCount?: number;
  processes?: string[];
  requiredSkills?: { name: string; minMonths?: number }[];
  preferredSkills?: { name: string }[];
};

// 国籍・出身国・民族等を条件に使用しない（§15）。入力バリデーションで拒否する。
const FORBIDDEN_CONDITION_RE = /(外国籍|国籍|出身国|民族|日本人限定|性別|男性のみ|女性のみ)/;

export function validateProjectInput(input: ProjectInput): string | null {
  const target = `${input.name} ${input.anonymousSummary}`;
  if (FORBIDDEN_CONDITION_RE.test(target)) {
    return "国籍・出身国・民族・性別を条件とする記載は登録できません（就労可否・言語能力等へ分解してください）";
  }
  return null;
}

export async function createProject(auth: AuthContext, input: ProjectInput) {
  const validationError = validateProjectInput(input);
  if (validationError) return { error: validationError };

  const count = await prisma.project.count({ where: { tenantCompanyId: auth.companyId } });
  const code = `P-${String(count + 1).padStart(4, "0")}`;
  const project = await prisma.project.create({
    data: {
      tenantCompanyId: auth.companyId,
      code,
      name: input.name,
      anonymousSummary: input.anonymousSummary,
      industry: input.industry,
      headcount: input.headcount ?? 1,
      startDate: new Date(input.startDate),
      endDate: input.endDate ? new Date(input.endDate) : null,
      longTerm: input.longTerm ?? false,
      locationCity: input.locationCity,
      nearestStation: input.nearestStation,
      onsiteDaysPerWeek: input.onsiteDaysPerWeek ?? 5,
      remoteLevel: input.remoteLevel ?? "R0",
      rateMinYen: input.rateMinYen,
      rateMaxYen: input.rateMaxYen,
      contractType: input.contractType,
      allowSubtier: input.allowSubtier ?? false,
      acceptedTypes: input.acceptedTypes ?? ["EMPLOYEE", "AFFILIATED", "FREELANCER"],
      interviewCount: input.interviewCount ?? 1,
      processes: input.processes ?? [],
      skills: {
        create: [
          ...(input.requiredSkills ?? []).map((s) => ({
            name: s.name,
            required: true,
            minMonths: s.minMonths,
          })),
          ...(input.preferredSkills ?? []).map((s) => ({ name: s.name, required: false })),
        ],
      },
    },
    include: { skills: true },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "ProjectCreated",
    targetType: "Project",
    targetId: project.id,
  });
  return { project: serializeProject(project, auth) };
}

// 案件の更新（自社のみ）。skills は全置換。
export async function updateProject(auth: AuthContext, projectId: string, input: ProjectInput) {
  const existing = await prisma.project.findFirst({
    where: { id: projectId, tenantCompanyId: auth.companyId },
  });
  if (!existing) return { error: "NOT_FOUND" };
  const validationError = validateProjectInput(input);
  if (validationError) return { error: validationError };

  const project = await prisma.$transaction(async (tx) => {
    await tx.projectSkill.deleteMany({ where: { projectId } });
    return tx.project.update({
      where: { id: projectId },
      data: {
        name: input.name,
        anonymousSummary: input.anonymousSummary,
        industry: input.industry ?? null,
        headcount: input.headcount ?? 1,
        startDate: new Date(input.startDate),
        endDate: input.endDate ? new Date(input.endDate) : null,
        longTerm: input.longTerm ?? false,
        locationCity: input.locationCity ?? null,
        nearestStation: input.nearestStation ?? null,
        onsiteDaysPerWeek: input.onsiteDaysPerWeek ?? 5,
        remoteLevel: input.remoteLevel ?? "R0",
        rateMinYen: input.rateMinYen ?? null,
        rateMaxYen: input.rateMaxYen,
        contractType: input.contractType ?? null,
        allowSubtier: input.allowSubtier ?? false,
        acceptedTypes: input.acceptedTypes ?? ["EMPLOYEE", "AFFILIATED", "FREELANCER"],
        interviewCount: input.interviewCount ?? 1,
        processes: input.processes ?? [],
        skills: {
          create: [
            ...(input.requiredSkills ?? []).map((s) => ({
              name: s.name,
              required: true,
              minMonths: s.minMonths,
            })),
            ...(input.preferredSkills ?? []).map((s) => ({ name: s.name, required: false })),
          ],
        },
      },
      include: { skills: true },
    });
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "ProjectUpdated",
    targetType: "Project",
    targetId: projectId,
  });
  return { project: serializeProject(project, auth) };
}

export async function publishProject(auth: AuthContext, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, tenantCompanyId: auth.companyId },
  });
  if (!project) return { error: "NOT_FOUND" as const };
  await prisma.project.update({ where: { id: projectId }, data: { status: "PUBLISHED" } });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "ProjectRouteOpened",
    targetType: "Project",
    targetId: projectId,
  });
  return { ok: true as const };
}

// 案件の進行状態（応募中/成約/終了）の手動設定
export async function setProjectWorkflowStatus(
  auth: AuthContext,
  projectId: string,
  workflowStatus: "RECRUITING" | "CONTRACTED" | "ENDED"
) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, tenantCompanyId: auth.companyId },
  });
  if (!project) return { error: "NOT_FOUND" as const };
  await prisma.project.update({ where: { id: projectId }, data: { workflowStatus } });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "ProjectUpdated",
    targetType: "Project",
    targetId: projectId,
    metadata: { workflowStatus },
  });
  return { ok: true as const };
}

// 案件の削除（物理削除）。エントリーが1件でもある案件は削除できない
export async function deleteProject(auth: AuthContext, projectId: string) {
  const existing = await prisma.project.findFirst({
    where: { id: projectId, tenantCompanyId: auth.companyId },
  });
  if (!existing) return { error: "NOT_FOUND" as const };
  const entries = await prisma.entry.count({ where: { projectId } });
  if (entries > 0) return { error: "エントリーがある案件は削除できません" };
  await prisma.$transaction([
    prisma.projectSkill.deleteMany({ where: { projectId } }),
    prisma.matchingResult.deleteMany({ where: { projectId } }),
    prisma.project.delete({ where: { id: projectId } }),
  ]);
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "ProjectDeleted",
    targetType: "Project",
    targetId: projectId,
  });
  return { ok: true as const };
}
