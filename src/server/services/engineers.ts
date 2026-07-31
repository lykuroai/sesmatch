import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/rbac";
import { ageBandLabel, rateBand } from "@/lib/constants";
import type { Engineer, EngineerSkill, PersonConsent } from "@prisma/client";

export function hasValidConsent(consents: PersonConsent[]): boolean {
  const now = new Date();
  return consents.some(
    (c) => !c.revokedAt && (!c.validUntil || c.validUntil >= now)
  );
}

type EngineerWithRels = Engineer & { skills: EngineerSkill[]; consents: PersonConsent[] };

// 開示レベルに応じたシリアライズ（§10）
// Level 1: 人材ID・年代・技術・経験・稼働日・10万円幅単価帯・エリア
// 自社かつ engineer.read.pii を持つ場合のみ氏名・実額単価を返す
export function serializeEngineer(e: EngineerWithRels, auth: AuthContext) {
  const own = e.tenantCompanyId === auth.companyId;
  const canPii = own && hasPermission(auth.roles, "engineer.read.pii");
  return {
    id: e.id,
    code: e.code,
    own,
    ageBand: ageBandLabel(e.ageBand),
    affiliationType: e.affiliationType,
    residenceCity: e.residenceCity,
    nearestStation: own ? e.nearestStation : null,
    availableFrom: e.availableFrom,
    availabilityRate: e.availabilityRate,
    rateBand: rateBand(e.desiredRateYen),
    maxOnsiteDaysPerWeek: e.maxOnsiteDaysPerWeek,
    remotePreference: e.remotePreference,
    travelOk: e.travelOk,
    status: e.status,
    summary: e.summary,
    processes: e.processes,
    roles: e.roles,
    industries: e.industries,
    skills: e.skills.map((s) => ({
      category: s.category,
      name: s.name,
      months: s.months,
      lastUsedAt: s.lastUsedAt,
    })),
    hasValidConsent: hasValidConsent(e.consents),
    workAuthStatus: own ? e.workAuthStatus : undefined,
    // ---- Level 2 相当（自社 + PII権限のみ）----
    name: canPii ? e.name : undefined,
    desiredRateYen: canPii ? e.desiredRateYen : undefined,
  };
}

export async function listEngineers(auth: AuthContext, scope: "own" | "public", query?: string) {
  const base =
    scope === "own"
      ? { tenantCompanyId: auth.companyId, deletedAt: null }
      : // 公開人材検索: 他社の公開済み人材（Level 1 匿名表示）
        { status: "PUBLISHED" as const, deletedAt: null, NOT: { tenantCompanyId: auth.companyId } };
  // キーワード検索: コード・概要・スキル名・居住エリア・工程/役割/業種。
  // 氏名（PII）は自社スコープのみ対象（他社の匿名人材を氏名で探索できないようにする）
  const q = query?.trim();
  const search = q
    ? {
        OR: [
          { code: { contains: q, mode: "insensitive" as const } },
          { summary: { contains: q, mode: "insensitive" as const } },
          { residenceCity: { contains: q, mode: "insensitive" as const } },
          { skills: { some: { name: { contains: q, mode: "insensitive" as const } } } },
          { processes: { has: q } },
          { roles: { has: q } },
          { industries: { has: q } },
          ...(scope === "own" ? [{ name: { contains: q, mode: "insensitive" as const } }] : []),
        ],
      }
    : {};
  const engineers = await prisma.engineer.findMany({
    where: { ...base, ...search },
    include: { skills: true, consents: true },
    orderBy: { createdAt: "desc" },
  });
  return engineers
    .filter((e) => scope === "own" || hasValidConsent(e.consents)) // 同意なしは公開検索に出さない
    .map((e) => serializeEngineer(e, auth));
}

export async function getEngineer(auth: AuthContext, id: string) {
  const e = await prisma.engineer.findUnique({
    where: { id },
    include: { skills: true, consents: true },
  });
  // 他テナントの非公開データは 404 相当（存在推測を防ぐ §29）
  if (!e) return null;
  if (e.deletedAt && e.tenantCompanyId !== auth.companyId) return null; // 論理削除済み（§26）
  if (e.tenantCompanyId !== auth.companyId && e.status !== "PUBLISHED") return null;
  return serializeEngineer(e, auth);
}

export type EngineerInput = {
  name: string;
  ageBand: number;
  affiliationType: "EMPLOYEE" | "AFFILIATED" | "FREELANCER" | "SUBTIER1";
  residenceCity?: string;
  nearestStation?: string;
  availableFrom?: string;
  availabilityRate?: number;
  desiredRateYen: number;
  commuteMaxMinutes?: number;
  maxOnsiteDaysPerWeek?: number;
  remotePreference?: "R0" | "R1" | "R2" | "R3" | "R4" | "R5";
  travelOk?: boolean;
  summary?: string;
  processes?: string[];
  roles?: string[];
  industries?: string[];
  skills?: { category: string; name: string; months: number; lastUsedAt?: string }[];
};

export async function createEngineer(auth: AuthContext, input: EngineerInput) {
  const count = await prisma.engineer.count({ where: { tenantCompanyId: auth.companyId } });
  const code = `E-${String(count + 1).padStart(4, "0")}`;
  const engineer = await prisma.engineer.create({
    data: {
      tenantCompanyId: auth.companyId,
      code,
      name: input.name,
      ageBand: input.ageBand,
      affiliationType: input.affiliationType,
      residenceCity: input.residenceCity,
      nearestStation: input.nearestStation,
      availableFrom: input.availableFrom ? new Date(input.availableFrom) : null,
      availabilityRate: input.availabilityRate ?? 100,
      desiredRateYen: input.desiredRateYen,
      commuteMaxMinutes: input.commuteMaxMinutes,
      maxOnsiteDaysPerWeek: input.maxOnsiteDaysPerWeek,
      remotePreference: input.remotePreference ?? "R0",
      travelOk: input.travelOk ?? false,
      summary: input.summary ?? "",
      processes: input.processes ?? [],
      roles: input.roles ?? [],
      industries: input.industries ?? [],
      skills: {
        create: (input.skills ?? []).map((s) => ({
          category: s.category as never,
          name: s.name,
          months: s.months,
          lastUsedAt: s.lastUsedAt ? new Date(s.lastUsedAt) : null,
        })),
      },
    },
    include: { skills: true, consents: true },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "EngineerCreated",
    targetType: "Engineer",
    targetId: engineer.id,
  });
  return serializeEngineer(engineer, auth);
}

// 人材の更新（自社のみ）。skills は全置換。name は指定時のみ更新（PII権限がない担当者の編集を許容）
export async function updateEngineer(
  auth: AuthContext,
  engineerId: string,
  input: Omit<EngineerInput, "name"> & { name?: string }
) {
  const existing = await prisma.engineer.findFirst({
    where: { id: engineerId, tenantCompanyId: auth.companyId, deletedAt: null },
  });
  if (!existing) return { error: { code: "NOT_FOUND" as const } };

  const engineer = await prisma.$transaction(async (tx) => {
    await tx.engineerSkill.deleteMany({ where: { engineerId } });
    return tx.engineer.update({
      where: { id: engineerId },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ageBand: input.ageBand,
        affiliationType: input.affiliationType,
        residenceCity: input.residenceCity ?? null,
        nearestStation: input.nearestStation ?? null,
        availableFrom: input.availableFrom ? new Date(input.availableFrom) : null,
        availabilityRate: input.availabilityRate ?? 100,
        desiredRateYen: input.desiredRateYen,
        commuteMaxMinutes: input.commuteMaxMinutes ?? null,
        maxOnsiteDaysPerWeek: input.maxOnsiteDaysPerWeek ?? null,
        remotePreference: input.remotePreference ?? "R0",
        travelOk: input.travelOk ?? false,
        summary: input.summary ?? "",
        processes: input.processes ?? [],
        roles: input.roles ?? [],
        industries: input.industries ?? [],
        skills: {
          create: (input.skills ?? []).map((s) => ({
            category: s.category as never,
            name: s.name,
            months: s.months,
            lastUsedAt: s.lastUsedAt ? new Date(s.lastUsedAt) : null,
          })),
        },
      },
      include: { skills: true, consents: true },
    });
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "EngineerUpdated",
    targetType: "Engineer",
    targetId: engineerId,
  });
  return { engineer: serializeEngineer(engineer, auth) };
}

export async function addConsent(
  auth: AuthContext,
  engineerId: string,
  input: { method: string; documentVersion: string; purposes: string[]; validUntil?: string }
) {
  const engineer = await prisma.engineer.findFirst({
    where: { id: engineerId, tenantCompanyId: auth.companyId },
  });
  if (!engineer) return null;
  const consent = await prisma.personConsent.create({
    data: {
      engineerId,
      consentedAt: new Date(),
      method: input.method,
      documentVersion: input.documentVersion,
      purposes: input.purposes,
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
    },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "ConsentRegistered",
    targetType: "Engineer",
    targetId: engineerId,
    metadata: { consentId: consent.id },
  });
  return consent;
}

// 公開（§11.3: 有効な同意がない人材は公開できない）
export async function publishEngineer(auth: AuthContext, engineerId: string) {
  const engineer = await prisma.engineer.findFirst({
    where: { id: engineerId, tenantCompanyId: auth.companyId },
    include: { consents: true },
  });
  if (!engineer) return { error: "NOT_FOUND" as const };
  if (!hasValidConsent(engineer.consents)) return { error: "CONSENT_REQUIRED" as const };
  if (engineer.workAuthStatus === "EXPIRED") return { error: "WORK_AUTH_EXPIRED" as const };
  await prisma.engineer.update({ where: { id: engineerId }, data: { status: "PUBLISHED" } });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "EngineerPublished",
    targetType: "Engineer",
    targetId: engineerId,
  });
  return { ok: true as const };
}

// 人材の削除（論理削除 §26 準拠）。deletedAt を設定して全画面・検索から除外する。
// 進行中のエントリーがある人材は削除できない（見送り・辞退のみなら可）。
// PII の物理削除は削除請求フロー（privacy）で行う
export async function deleteEngineer(auth: AuthContext, engineerId: string) {
  const existing = await prisma.engineer.findFirst({
    where: { id: engineerId, tenantCompanyId: auth.companyId, deletedAt: null },
  });
  if (!existing) return { error: { code: "NOT_FOUND" as const } };
  const activeEntries = await prisma.entry.count({
    where: { engineerId, status: { notIn: ["DECLINED", "WITHDRAWN"] } },
  });
  if (activeEntries > 0)
    return {
      error: {
        code: "VERSION_CONFLICT" as const,
        message: "進行中のエントリーがあるため削除できません（見送り・辞退後に削除してください）",
      },
    };
  await prisma.engineer.update({
    where: { id: engineerId },
    data: { deletedAt: new Date() },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "EngineerDeleted",
    targetType: "Engineer",
    targetId: engineerId, // 監査ログに氏名等の PII は含めない
  });
  return { ok: true as const };
}
