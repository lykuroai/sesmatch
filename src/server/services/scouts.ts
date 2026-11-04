// 一斉スカウト・AI 下書き・反応率（PRO版仕様書 §4.6）
//
// - 人材検索の結果から最大20名を選び、自社案件へのスカウト（Entry の SCOUT）をまとめて作成する
// - 1社あたり1日50件まで（スパム抑止）。超過は 429 SCOUT_DAILY_LIMIT
// - 重複応募ブロック（同一案件×同一人材）に従い、既存の商談がある人材はスキップして結果に表示する
// - 本文はテンプレート（変数: {案件名} {単価上限} {勤務地} {在宅} {開始時期}）。送信前の人手確認は画面側で必須とし、
//   連絡先検出（§21）を適用する。LLM の下書きは案件要約と人材の Level 1 情報だけから生成し、Level 2 情報は渡さない
// - 各スカウトには本文を最初のメッセージとして付ける（受信通知は商談申込みの通知で兼ねる）

import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/auth/session";
import { assertFeature } from "@/server/plan/features";
import { detectContactInfo } from "@/server/pipeline/pii";
import { llmGateway } from "@/server/pipeline/llm";
import { REMOTE_LEVEL_LABELS } from "@/lib/constants";
import { createEntry } from "./entries";
import { listEngineers } from "./engineers";

export const MAX_SCOUTS_PER_REQUEST = 20;
export const MAX_SCOUTS_PER_DAY = 50;

type ProjectForTemplate = { name: string; rateMaxYen: number; locationCity: string | null; remoteLevel: string; startDate: Date };

// テンプレート変数の展開（純粋関数）
export function renderScoutTemplate(body: string, p: ProjectForTemplate): string {
  return body
    .replace(/\{案件名\}/g, p.name)
    .replace(/\{単価上限\}/g, `${Math.floor(p.rateMaxYen / 10_000)}万円`)
    .replace(/\{勤務地\}/g, p.locationCity ?? "応相談")
    .replace(/\{在宅\}/g, REMOTE_LEVEL_LABELS[p.remoteLevel] ?? p.remoteLevel)
    .replace(/\{開始時期\}/g, new Date(p.startDate).toISOString().slice(0, 10));
}

// 当日（JST）の開始時刻
export function startOfTodayJst(now = new Date()): Date {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - 9 * 3600_000);
}

export type BulkScoutResult = {
  batchId: string;
  created: { entryId: string; engineerId: string; engineerCode: string }[];
  skipped: { engineerId: string; engineerCode: string; reason: string }[];
};

export async function createBulkScout(
  auth: AuthContext,
  input: { projectId: string; engineerIds: string[]; body: string }
): Promise<BulkScoutResult | { error: { code: string; message?: string } }> {
  const gate = assertFeature(auth, "bulk_scout");
  if (gate) return gate;
  const ids = [...new Set(input.engineerIds)];
  if (ids.length === 0) return { error: { code: "VALIDATION_ERROR", message: "人材を選択してください" } };
  if (ids.length > MAX_SCOUTS_PER_REQUEST)
    return { error: { code: "VALIDATION_ERROR", message: `一斉スカウトは1回に${MAX_SCOUTS_PER_REQUEST}名までです` } };
  const body = input.body.trim();
  if (!body) return { error: { code: "VALIDATION_ERROR", message: "スカウト文を入力してください" } };
  const findings = detectContactInfo(body);
  if (findings.length > 0) {
    await audit({
      tenantCompanyId: auth.companyId,
      actorUserId: auth.userAccountId,
      action: "ContactInfoBlocked",
      targetType: "ScoutBatch",
      targetId: input.projectId,
      metadata: { kinds: findings, field: "scoutTemplate" },
    });
    return {
      error: {
        code: "PII_VALIDATION_FAILED",
        message: `スカウト文に連絡先情報（${findings.join(", ")}）を含めることはできません。修正してください`,
      },
    };
  }
  const project = await prisma.project.findFirst({ where: { id: input.projectId, tenantCompanyId: auth.companyId } });
  if (!project) return { error: { code: "NOT_FOUND" } };

  // 1日上限（JST）: 当日に自社が作成した一斉スカウト件数
  const todayCount = await prisma.entry.count({
    where: { createdByCompanyId: auth.companyId, scoutBatchId: { not: null }, createdAt: { gte: startOfTodayJst() } },
  });
  if (todayCount + ids.length > MAX_SCOUTS_PER_DAY)
    return {
      error: {
        code: "SCOUT_DAILY_LIMIT",
        message: `一斉スカウトは1日${MAX_SCOUTS_PER_DAY}件までです（本日 ${todayCount}件送信済み）`,
      },
    };

  const engineers = await prisma.engineer.findMany({ where: { id: { in: ids } }, select: { id: true, code: true } });
  const codeById = new Map(engineers.map((e) => [e.id, e.code]));
  const batch = await prisma.scoutBatch.create({
    data: {
      tenantCompanyId: auth.companyId,
      projectId: project.id,
      memberId: auth.memberId,
      templateBody: body,
      requestedCount: ids.length,
      createdCount: 0,
      skippedCount: 0,
    },
  });
  const rendered = renderScoutTemplate(body, project);
  const result: BulkScoutResult = { batchId: batch.id, created: [], skipped: [] };
  for (const engineerId of ids) {
    const code = codeById.get(engineerId) ?? "?";
    if (!codeById.has(engineerId)) {
      result.skipped.push({ engineerId, engineerCode: code, reason: "人材が見つかりません" });
      continue;
    }
    const r = await createEntry(auth, { type: "SCOUT", projectId: project.id, engineerId });
    if ("error" in r && r.error) {
      result.skipped.push({ engineerId, engineerCode: code, reason: r.error.message ?? r.error.code });
      continue;
    }
    const entry = r.entry!;
    await prisma.entry.update({ where: { id: entry.id }, data: { scoutBatchId: batch.id } });
    await prisma.entryMessage.create({
      data: { entryId: entry.id, senderCompanyId: auth.companyId, senderMemberId: auth.memberId, senderName: auth.userName, body: rendered },
    });
    result.created.push({ entryId: entry.id, engineerId, engineerCode: code });
  }
  await prisma.scoutBatch.update({
    where: { id: batch.id },
    data: { createdCount: result.created.length, skippedCount: result.skipped.length },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "BulkScoutSent",
    targetType: "ScoutBatch",
    targetId: batch.id,
    metadata: { projectId: project.id, requested: ids.length, created: result.created.length, skipped: result.skipped.length },
  });
  return result;
}

// AI 下書き: 案件の要約と人材の Level 1 情報から LLM が本文を生成する。送信前の人手確認が必須
export async function draftScoutMessage(auth: AuthContext, input: { projectId: string; engineerIds: string[] }) {
  const gate = assertFeature(auth, "bulk_scout");
  if (gate) return gate;
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, tenantCompanyId: auth.companyId },
    include: { skills: true },
  });
  if (!project) return { error: { code: "NOT_FOUND" as const } };
  const ids = new Set(input.engineerIds.slice(0, MAX_SCOUTS_PER_REQUEST));
  const { items } = await listEngineers(auth, "public");
  const engineers = items
    .filter((e) => ids.has(e.id))
    .map((e) => ({ code: e.code, ageBand: e.ageBand, rateBand: e.rateBand, skills: e.skills.map((s) => s.name), processes: e.processes }));
  const body = await llmGateway.draftScoutMessage({
    project: {
      name: project.name,
      summary: project.anonymousSummary,
      requiredSkills: project.skills.filter((s) => s.required).map((s) => s.name),
      preferredSkills: project.skills.filter((s) => !s.required).map((s) => s.name),
      rateMaxYen: project.rateMaxYen,
      locationCity: project.locationCity,
      remoteLabel: REMOTE_LEVEL_LABELS[project.remoteLevel] ?? project.remoteLevel,
      startDate: project.startDate.toISOString().slice(0, 10),
    },
    engineers,
  });
  // 生成文に連絡先が含まれていれば除去を求める（送信時にも再検査する）
  const findings = detectContactInfo(body);
  return { body, warnings: findings.length > 0 ? [`生成文に連絡先らしき記載（${findings.join(", ")}）があります。削除してください`] : [] };
}

// ---- 反応率 ----

export type ScoutBatchStats = { sent: number; approved: number; declined: number; pending: number; approvalRate: number | null };
const APPROVED = new Set(["MUTUALLY_APPROVED", "INTERVIEW", "CONDITIONS", "CONTRACTING", "CONTRACTED"]);
const DECLINED = new Set(["DECLINED", "WITHDRAWN"]);

export function scoutBatchStats(entries: { status: string; disclosed: boolean }[]): ScoutBatchStats {
  const sent = entries.length;
  const approved = entries.filter((e) => e.disclosed || APPROVED.has(e.status)).length;
  const declined = entries.filter((e) => DECLINED.has(e.status)).length;
  return { sent, approved, declined, pending: sent - approved - declined, approvalRate: sent > 0 ? approved / sent : null };
}

export async function listScoutBatches(auth: AuthContext) {
  const batches = await prisma.scoutBatch.findMany({
    where: { tenantCompanyId: auth.companyId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { entries: { select: { status: true, disclosure: { select: { id: true } } } } },
  });
  const projects = await prisma.project.findMany({
    where: { id: { in: batches.map((b) => b.projectId) } },
    select: { id: true, code: true, name: true },
  });
  const byId = new Map(projects.map((p) => [p.id, p]));
  return batches.map((b) => ({
    id: b.id,
    createdAt: b.createdAt,
    project: byId.get(b.projectId) ?? { id: b.projectId, code: "?", name: "" },
    requestedCount: b.requestedCount,
    createdCount: b.createdCount,
    skippedCount: b.skippedCount,
    stats: scoutBatchStats(b.entries.map((e) => ({ status: e.status, disclosed: e.disclosure != null }))),
  }));
}

export async function getScoutBatch(auth: AuthContext, id: string) {
  const b = await prisma.scoutBatch.findFirst({
    where: { id, tenantCompanyId: auth.companyId },
    include: {
      entries: {
        include: { engineer: { select: { id: true, code: true } }, disclosure: { select: { id: true } }, messages: { select: { readAt: true, senderCompanyId: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!b) return null;
  const project = await prisma.project.findUnique({ where: { id: b.projectId }, select: { id: true, code: true, name: true } });
  return {
    id: b.id,
    createdAt: b.createdAt,
    templateBody: b.templateBody,
    project: project ?? { id: b.projectId, code: "?", name: "" },
    requestedCount: b.requestedCount,
    createdCount: b.createdCount,
    skippedCount: b.skippedCount,
    stats: scoutBatchStats(b.entries.map((e) => ({ status: e.status, disclosed: e.disclosure != null }))),
    entries: b.entries.map((e) => ({
      id: e.id,
      status: e.status,
      engineerId: e.engineer.id,
      engineerCode: e.engineer.code,
      // 既読: 自社が送ったメッセージが相手に開かれたか
      read: e.messages.some((m) => m.senderCompanyId === auth.companyId && m.readAt != null),
      createdAt: e.createdAt,
    })),
  };
}
