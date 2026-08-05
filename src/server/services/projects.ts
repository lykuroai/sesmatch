import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/auth/session";
import { DISPATCH_CONTRACT_TYPE, LIST_PAGE_SIZE, type ProjectContractType } from "@/lib/constants";
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
    dispatchConflictDate: p.dispatchConflictDate,
    dispatchDemandManager: p.dispatchDemandManager,
    dispatchProhibitedConfirmed: p.dispatchProhibitedConfirmed,
    allowSubtier: p.allowSubtier,
    noForeignNational: p.noForeignNational,
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

// page 指定時は 50件/ページでページングし、未指定時は全件を返す（詳細画面の候補選択用）
export async function listProjects(
  auth: AuthContext,
  scope: "own" | "public",
  query?: string,
  page?: number
) {
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
  const where = { ...base, ...search };
  const [total, projects] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      include: { skills: true },
      orderBy: { createdAt: "desc" },
      ...(page ? { skip: (page - 1) * LIST_PAGE_SIZE, take: LIST_PAGE_SIZE } : {}),
    }),
  ]);
  return { items: projects.map((p) => serializeProject(p, auth)), total };
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
  contractType: ProjectContractType;
  dispatchConflictDate?: string; // 労働者派遣: 抵触日
  dispatchDemandManager?: string; // 労働者派遣: 派遣先責任者
  dispatchProhibitedConfirmed?: boolean; // 労働者派遣: 派遣禁止業務に該当しないことの確認
  allowSubtier?: boolean;
  noForeignNational?: boolean; // 外国籍不可（SES案件の受入条件）
  acceptedTypes?: ("EMPLOYEE" | "AFFILIATED" | "FREELANCER" | "SUBTIER1")[];
  interviewCount?: number;
  processes?: string[];
  requiredSkills?: { name: string; minMonths?: number }[];
  preferredSkills?: { name: string }[];
};

// 案件内容の記載制限は2026-08-04に撤廃（国籍・性別等のキーワード拒否を行わない）。
// なおマッチングエンジン自体はこれらの属性を条件として扱わない（§15/§19 の設計は不変）
export function validateProjectInput(input: ProjectInput): string | null {
  // 労働者派遣（基本契約第4条）: 抵触日・派遣先責任者・派遣禁止業務非該当の確認が必須
  if (input.contractType === DISPATCH_CONTRACT_TYPE) {
    if (!input.dispatchConflictDate) return "労働者派遣では抵触日の入力が必要です";
    if (!input.dispatchDemandManager?.trim()) return "労働者派遣では派遣先責任者の入力が必要です";
    if (!input.dispatchProhibitedConfirmed)
      return "労働者派遣では派遣禁止業務に該当しないことの確認が必要です";
  }
  return null;
}

// 労働者派遣では一社下不可・直接雇用（自社社員）のみ受入を自動適用する（基本契約第4条）
function dispatchGuardedFields(input: ProjectInput) {
  const isDispatch = input.contractType === DISPATCH_CONTRACT_TYPE;
  return {
    contractType: input.contractType,
    dispatchConflictDate:
      isDispatch && input.dispatchConflictDate ? new Date(input.dispatchConflictDate) : null,
    dispatchDemandManager: isDispatch ? (input.dispatchDemandManager?.trim() ?? null) : null,
    dispatchProhibitedConfirmed: isDispatch,
    allowSubtier: isDispatch ? false : (input.allowSubtier ?? false),
    acceptedTypes: isDispatch
      ? ["EMPLOYEE" as const]
      : (input.acceptedTypes ?? ["EMPLOYEE" as const, "AFFILIATED" as const, "FREELANCER" as const]),
  };
}

// 表示用コードの採番: システム全体の最大番号+1（企業をまたいで一意。件数方式だと物理削除で
// 番号が詰まり既存コードと衝突する）。形式は P+6桁（例: P000001）
async function nextProjectCode(): Promise<string> {
  const rows = await prisma.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING(code FROM '[0-9]+$') AS INTEGER)) AS max
    FROM projects WHERE code ~ '^P-?[0-9]+$'`;
  return `P${String(Number(rows[0]?.max ?? 0) + 1).padStart(6, "0")}`;
}

export async function createProject(auth: AuthContext, input: ProjectInput) {
  const validationError = validateProjectInput(input);
  if (validationError) return { error: validationError };

  const code = await nextProjectCode();
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
      ...dispatchGuardedFields(input),
      noForeignNational: input.noForeignNational ?? false,
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
        ...dispatchGuardedFields(input),
        noForeignNational: input.noForeignNational ?? false,
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
