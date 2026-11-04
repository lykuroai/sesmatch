// 保存検索と新着アラート（PRO版仕様書 §4.3）
//
// - 案件検索・人材検索の条件を保存し（10件/社）、新しく公開された他社の案件・人材が条件に合えばメールで知らせる
// - 評価は15分間隔（instrumentation.ts のプロセス内タイマー）。IMMEDIATE は都度、DAILY は 9:00 JST に1回
// - 同一対象の二重通知は saved_search_hits で防ぐ。初回評価の基準は保存検索の作成時刻（古い掲載は通知しない）
// - 通知内容は Level 1 の範囲（匿名カード相当）。PRO のため掲載企業名は含めるが、人材の氏名・実額単価は含めない
// - 作成者が停止・退職、または企業が PRO でなくなった場合は通知しない（条件は保持）

import { z } from "zod";
import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/auth/session";
import { effectivePlan, hasFeature } from "@/server/plan/features";
import { assertLimit } from "@/server/plan/limits";
import { listProjects } from "./projects";
import { listEngineers } from "./engineers";
import { expandSearchTerms } from "./skill-aliases";
import { sendMail, appBaseUrl } from "@/server/mail";
import { errorMessageOf, reportSystemError } from "@/server/system-error";

export const searchCriteriaSchema = z.object({
  q: z.string().max(200).optional(),
  skills: z.array(z.string().max(100)).max(20).optional(),
  rateMin: z.number().int().min(0).max(1000).nullable().optional(), // 万円
  rateMax: z.number().int().min(0).max(1000).nullable().optional(),
  remote: z.string().max(10).optional(), // RemoteLevel（R0〜R5）。未指定は全て
  location: z.string().max(100).optional(),
  start: z.string().max(5).optional(), // 開始時期（か月以内）
});
export type SearchCriteria = z.infer<typeof searchCriteriaSchema>;

export const MAX_ALERT_ITEMS_PER_MAIL = 20;

// 検索画面の URL クエリへ（保存検索から検索画面を開くリンク用）
export function criteriaToQuery(c: SearchCriteria): string {
  const p = new URLSearchParams();
  if (c.q) p.set("q", c.q);
  if (c.skills && c.skills.length > 0) p.set("skills", c.skills.join(","));
  if (c.rateMin != null) p.set("rateMin", String(c.rateMin));
  if (c.rateMax != null) p.set("rateMax", String(c.rateMax));
  if (c.remote && c.remote !== "all") p.set("remote", c.remote);
  if (c.location && c.location !== "all") p.set("location", c.location);
  if (c.start && c.start !== "all") p.set("start", c.start);
  return p.toString();
}

// 条件の表示用要約
export function describeCriteria(c: SearchCriteria): string {
  const parts: string[] = [];
  if (c.q) parts.push(`キーワード: ${c.q}`);
  if (c.skills && c.skills.length > 0) parts.push(`スキル: ${c.skills.join("・")}`);
  if (c.rateMin != null || c.rateMax != null) parts.push(`単価: ${c.rateMin ?? ""}〜${c.rateMax ?? ""}万円`);
  if (c.remote && c.remote !== "all") parts.push(`在宅: ${c.remote}`);
  if (c.location && c.location !== "all") parts.push(`勤務地: ${c.location}`);
  if (c.start && c.start !== "all") parts.push(`開始: ${c.start}か月以内`);
  return parts.length > 0 ? parts.join(" / ") : "条件なし（すべて）";
}

// 用語辞書で展開した検索語（検索画面と同じ名寄せ検索）
export type ExpandedTerms = { qTerms: string[]; skillTerms: Map<string, string[]> };
export async function expandCriteriaTerms(c: SearchCriteria): Promise<ExpandedTerms> {
  const q = (c.q ?? "").trim().toLowerCase();
  const qTerms = q ? (await expandSearchTerms(q)).map((v) => v.toLowerCase()) : [];
  const skillTerms = new Map(
    await Promise.all(
      (c.skills ?? []).map(async (s) => [s, (await expandSearchTerms(s)).map((v) => v.toLowerCase())] as const)
    )
  );
  return { qTerms, skillTerms };
}

function startLimitOf(c: SearchCriteria, now: Date): Date | null {
  if (!c.start || c.start === "all") return null;
  const months = parseInt(c.start);
  if (!Number.isFinite(months)) return null;
  const d = new Date(now);
  d.setMonth(d.getMonth() + months);
  return d;
}

type ProjectCard = Awaited<ReturnType<typeof listProjects>>["items"][number];
type EngineerCard = Awaited<ReturnType<typeof listEngineers>>["items"][number];

// 検索画面（projects/page.tsx）と同じ判定。純粋関数（テスト対象）
export function matchProjectCriteria(p: ProjectCard, c: SearchCriteria, t: ExpandedTerms, now = new Date()): boolean {
  const skills = c.skills ?? [];
  if (skills.length > 0) {
    const names = [
      ...[...p.requiredSkills, ...p.preferredSkills].map((s) => s.name),
      p.industry ?? "",
      ...p.processes,
    ].map((n) => n.toLowerCase());
    if (!skills.every((s) => (t.skillTerms.get(s) ?? [s.toLowerCase()]).some((v) => names.some((n) => n.includes(v)))))
      return false;
  }
  if (c.rateMin && p.rateMaxYen < c.rateMin * 10_000) return false;
  if (c.rateMax && (p.rateMinYen ?? 0) > c.rateMax * 10_000) return false;
  if (c.remote && c.remote !== "all" && p.remoteLevel !== c.remote) return false;
  if (c.location && c.location !== "all" && p.locationCity !== c.location) return false;
  const startLimit = startLimitOf(c, now);
  if (startLimit && new Date(p.startDate) > startLimit) return false;
  if (t.qTerms.length > 0) {
    const haystack = [
      p.code,
      p.name,
      p.anonymousSummary,
      p.industry ?? "",
      ...p.processes,
      ...p.requiredSkills.map((s) => s.name),
      ...p.preferredSkills.map((s) => s.name),
    ]
      .join("\n")
      .toLowerCase();
    if (!t.qTerms.some((v) => haystack.includes(v))) return false;
  }
  return true;
}

// 検索画面（engineers/page.tsx）と同じ判定。氏名は Level 1 では返らないため対象外
export function matchEngineerCriteria(e: EngineerCard, c: SearchCriteria, t: ExpandedTerms, now = new Date()): boolean {
  const skills = c.skills ?? [];
  if (skills.length > 0) {
    const names = [...e.skills.map((s) => s.name), ...e.processes, ...e.roles, ...e.industries].map((n) =>
      n.toLowerCase()
    );
    if (!skills.every((s) => (t.skillTerms.get(s) ?? [s.toLowerCase()]).some((v) => names.some((n) => n.includes(v)))))
      return false;
  }
  const bandLower = parseInt(e.rateBand) || 0;
  if (c.rateMin && bandLower + 10 < c.rateMin) return false;
  if (c.rateMax && bandLower > c.rateMax) return false;
  if (c.remote && c.remote !== "all" && e.remotePreference !== c.remote) return false;
  if (c.location && c.location !== "all" && e.residenceCity !== c.location) return false;
  const startLimit = startLimitOf(c, now);
  if (startLimit && e.availableFrom && new Date(e.availableFrom) > startLimit) return false;
  if (t.qTerms.length > 0) {
    const haystack = [
      e.code,
      e.summary ?? "",
      e.residenceCity ?? "",
      ...e.skills.map((s) => s.name),
      ...e.processes,
      ...e.roles,
      ...e.industries,
    ]
      .join("\n")
      .toLowerCase();
    if (!t.qTerms.some((v) => haystack.includes(v))) return false;
  }
  return true;
}

// ---- CRUD ----

export async function listSavedSearches(auth: AuthContext, kind?: "PROJECT" | "ENGINEER") {
  const items = await prisma.savedSearch.findMany({
    where: { tenantCompanyId: auth.companyId, ...(kind ? { kind } : {}) },
    orderBy: { createdAt: "desc" },
  });
  return items.map((s) => ({
    id: s.id,
    kind: s.kind,
    name: s.name,
    criteria: s.criteria as SearchCriteria,
    query: criteriaToQuery(s.criteria as SearchCriteria),
    description: describeCriteria(s.criteria as SearchCriteria),
    notify: s.notify,
    own: s.memberId === auth.memberId,
    lastNotifiedAt: s.lastNotifiedAt,
    createdAt: s.createdAt,
  }));
}

export async function createSavedSearch(
  auth: AuthContext,
  input: { kind: "PROJECT" | "ENGINEER"; name: string; criteria: SearchCriteria; notify?: "IMMEDIATE" | "DAILY" | "OFF" }
) {
  const current = await prisma.savedSearch.count({ where: { tenantCompanyId: auth.companyId } });
  const limit = assertLimit(auth.plan, "saved_searches", current);
  if (limit) return limit;
  const saved = await prisma.savedSearch.create({
    data: {
      tenantCompanyId: auth.companyId,
      memberId: auth.memberId,
      kind: input.kind,
      name: input.name.trim().slice(0, 100) || "保存した検索条件",
      criteria: input.criteria,
      notify: input.notify ?? "IMMEDIATE",
    },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "SavedSearchCreated",
    targetType: "SavedSearch",
    targetId: saved.id,
    metadata: { kind: input.kind, notify: saved.notify },
  });
  return { ok: true, id: saved.id };
}

export async function updateSavedSearch(
  auth: AuthContext,
  id: string,
  input: { name?: string; notify?: "IMMEDIATE" | "DAILY" | "OFF"; criteria?: SearchCriteria }
) {
  const saved = await prisma.savedSearch.findFirst({ where: { id, tenantCompanyId: auth.companyId } });
  if (!saved) return { error: { code: "NOT_FOUND" as const } };
  await prisma.savedSearch.update({
    where: { id },
    data: {
      ...(input.name != null ? { name: input.name.trim().slice(0, 100) || saved.name } : {}),
      ...(input.notify ? { notify: input.notify } : {}),
      ...(input.criteria ? { criteria: input.criteria } : {}),
    },
  });
  return { ok: true };
}

export async function deleteSavedSearch(auth: AuthContext, id: string) {
  const saved = await prisma.savedSearch.findFirst({ where: { id, tenantCompanyId: auth.companyId } });
  if (!saved) return { error: { code: "NOT_FOUND" as const } };
  await prisma.savedSearch.delete({ where: { id } });
  return { ok: true };
}

// ---- 評価と通知 ----

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const jstDateKey = (d: Date) => new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
const jstHour = (d: Date) => new Date(d.getTime() + JST_OFFSET_MS).getUTCHours();

// DAILY の実行判定: 9時台（JST）で、その日（JST）にまだ評価していない
export function isDailyDue(now: Date, lastEvaluatedAt: Date | null): boolean {
  if (jstHour(now) !== 9) return false;
  return !lastEvaluatedAt || jstDateKey(lastEvaluatedAt) !== jstDateKey(now);
}

export type AlertRunSummary = { evaluated: number; notified: number; items: number; skipped: number };

// 全テナントの保存検索を評価して通知する（プロセス内タイマーから15分間隔で呼ばれる）。
// force=true は時刻に関係なく DAILY も評価する（テスト・手動実行用）
export async function evaluateSavedSearches(opts?: { now?: Date; force?: boolean }): Promise<AlertRunSummary> {
  const now = opts?.now ?? new Date();
  const summary: AlertRunSummary = { evaluated: 0, notified: 0, items: 0, skipped: 0 };
  const searches = await prisma.savedSearch.findMany({ where: { notify: { not: "OFF" } } });
  for (const s of searches) {
    try {
      if (s.notify === "DAILY" && !opts?.force && !isDailyDue(now, s.lastEvaluatedAt)) {
        summary.skipped++;
        continue;
      }
      const result = await evaluateOne(s.id, now);
      summary.evaluated++;
      if (result.notified) {
        summary.notified++;
        summary.items += result.items;
      }
    } catch (e) {
      await reportSystemError({
        source: "API",
        message: `保存検索の評価に失敗: ${errorMessageOf(e)}`,
        error: e,
        tenantCompanyId: s.tenantCompanyId,
        targetType: "SavedSearch",
        targetId: s.id,
      });
    }
  }
  return summary;
}

// 1件の保存検索を評価し、新着があればメール通知する
export async function evaluateOne(savedSearchId: string, now = new Date()): Promise<{ notified: boolean; items: number }> {
  const s = await prisma.savedSearch.findUniqueOrThrow({ where: { id: savedSearchId } });
  const [member, company] = await Promise.all([
    prisma.companyMember.findUnique({ where: { id: s.memberId }, include: { userAccount: true, roles: true } }),
    prisma.company.findUniqueOrThrow({ where: { id: s.tenantCompanyId } }),
  ]);
  // 企業が PRO でない・作成者が停止・企業停止なら通知しない（評価カーソルは進めず、条件は保持）
  if (!member || member.status !== "ACTIVE" || company.status !== "ACTIVE") return { notified: false, items: 0 };
  const auth: AuthContext = {
    userAccountId: member.userAccountId,
    userName: member.userAccount.name,
    email: member.userAccount.email,
    memberId: member.id,
    companyId: company.id,
    companyName: company.name,
    roles: member.roles.map((r) => r.role),
    plan: effectivePlan(company, now),
  };
  if (!hasFeature(auth, "saved_search_alert", now)) return { notified: false, items: 0 };

  const criteria = searchCriteriaSchema.parse(s.criteria ?? {});
  const since = s.lastEvaluatedAt ?? s.createdAt;
  const terms = await expandCriteriaTerms(criteria);
  const hits = new Set((await prisma.savedSearchHit.findMany({ where: { savedSearchId: s.id }, select: { targetId: true } })).map((h) => h.targetId));

  let lines: string[] = [];
  let targetIds: string[] = [];
  if (s.kind === "PROJECT") {
    const recent = new Set(
      (
        await prisma.project.findMany({
          where: { status: "PUBLISHED", tenantCompanyId: { not: s.tenantCompanyId }, updatedAt: { gt: since } },
          select: { id: true },
        })
      ).map((p) => p.id)
    );
    if (recent.size > 0) {
      const { items } = await listProjects(auth, "public");
      const matched = items.filter((p) => recent.has(p.id) && !hits.has(p.id) && matchProjectCriteria(p, criteria, terms, now));
      targetIds = matched.map((p) => p.id);
      lines = matched.slice(0, MAX_ALERT_ITEMS_PER_MAIL).map(
        (p) =>
          `・${p.code} ${p.name}${p.partnerCompanyName ? `（${p.partnerCompanyName}）` : ""}\n` +
          `  単価上限 ${Math.floor(p.rateMaxYen / 10_000)}万円 / ${p.locationCity ?? "勤務地未定"} / 開始 ${String(p.startDate).slice(0, 10)}\n` +
          `  必須: ${p.requiredSkills.map((x) => x.name).join("・") || "-"}\n` +
          `  ${appBaseUrl()}/projects/${p.id}`
      );
    }
  } else {
    const recent = new Set(
      (
        await prisma.engineer.findMany({
          where: { status: "PUBLISHED", deletedAt: null, tenantCompanyId: { not: s.tenantCompanyId }, updatedAt: { gt: since } },
          select: { id: true },
        })
      ).map((e) => e.id)
    );
    if (recent.size > 0) {
      const { items } = await listEngineers(auth, "public");
      const matched = items.filter((e) => recent.has(e.id) && !hits.has(e.id) && matchEngineerCriteria(e, criteria, terms, now));
      targetIds = matched.map((e) => e.id);
      lines = matched.slice(0, MAX_ALERT_ITEMS_PER_MAIL).map(
        (e) =>
          `・${e.code}${e.partnerCompanyName ? `（${e.partnerCompanyName}）` : ""} ${e.ageBand} / 単価帯 ${e.rateBand}\n` +
          `  スキル: ${e.skills.slice(0, 8).map((x) => x.name).join("・") || "-"} / 稼働可能 ${e.availableFrom ? String(e.availableFrom).slice(0, 10) : "即日"}\n` +
          `  ${appBaseUrl()}/engineers/${e.id}`
      );
    }
  }

  await prisma.savedSearch.update({ where: { id: s.id }, data: { lastEvaluatedAt: now } });
  if (targetIds.length === 0) return { notified: false, items: 0 };

  await prisma.savedSearchHit.createMany({
    data: targetIds.map((targetId) => ({ savedSearchId: s.id, targetId, notifiedAt: now })),
    skipDuplicates: true,
  });
  const kindLabel = s.kind === "PROJECT" ? "案件" : "人材";
  const basePath = s.kind === "PROJECT" ? "/projects" : "/engineers";
  const more = targetIds.length > MAX_ALERT_ITEMS_PER_MAIL ? `\n…ほか ${targetIds.length - MAX_ALERT_ITEMS_PER_MAIL} 件` : "";
  await sendMail({
    to: member.userAccount.email,
    subject: `【SES DirectMatch】保存検索「${s.name}」に新着${kindLabel} ${targetIds.length}件`,
    body: `${member.userAccount.name} 様

保存した検索条件「${s.name}」（${describeCriteria(criteria)}）に合う${kindLabel}が新しく公開されました。

${lines.join("\n\n")}${more}

検索画面で確認する:
${appBaseUrl()}${basePath}?${criteriaToQuery(criteria)}

※この通知は PRO 版の新着アラートです。通知方法の変更・停止は検索画面の「保存した検索条件」から行えます。`,
  });
  await prisma.savedSearch.update({ where: { id: s.id }, data: { lastNotifiedAt: now } });
  return { notified: true, items: targetIds.length };
}
