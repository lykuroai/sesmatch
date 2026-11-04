// 監査ログのエクスポート（PRO版仕様書 §4.14）
//
// - 期間指定で CSV／JSON を出力する（自社テナント分のみ、最大 50,000 件）。出力自体も監査に記録する
// - 月次自動送付: 毎月1日（JST）に前月分のダウンロードリンク（署名付き・7日間有効）を代表へメールする。
//   リンクはログイン（audit.read 権限）が必要で、添付はしない。送付済みは監査ログで判定して二重送付を防ぐ
// - 閲覧（画面）は基本版と同じ。保存期間はプランで変えない

import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/auth/session";
import { hasFeature } from "@/server/plan/features";
import { appBaseUrl, sendMail } from "@/server/mail";
import { toCsv } from "@/lib/csv";
import { AUDIT_ACTION_LABELS, AUDIT_TARGET_LABELS, formatAuditMetadata } from "@/lib/audit-labels";

export const AUDIT_EXPORT_MAX_ROWS = 50_000;
export const MONTHLY_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AuditExportFormat = "csv" | "json";

// JST の月初・翌月初（UTC Date）
export function monthRangeJst(month: string): { from: Date; to: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { from: new Date(Date.UTC(y, mo - 1, 1) - 9 * 3600_000), to: new Date(Date.UTC(y, mo, 1) - 9 * 3600_000) };
}

export const previousMonthJst = (now: Date) => {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth(); // 0-11（今月）→ 前月は m-1
  const d = new Date(Date.UTC(y, m - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export async function exportAuditEvents(
  auth: AuthContext,
  params: { from: Date; to: Date; format: AuditExportFormat; reason?: string }
) {
  if (!hasFeature(auth, "audit_export")) return { error: { code: "PLAN_REQUIRED" as const, message: "監査ログのエクスポートは PRO 版でご利用いただけます" } };
  if (!(params.from < params.to)) return { error: { code: "VALIDATION_ERROR" as const, message: "期間の指定が不正です" } };
  if (params.to.getTime() - params.from.getTime() > 366 * 86_400_000)
    return { error: { code: "VALIDATION_ERROR" as const, message: "期間は1年以内で指定してください" } };
  const events = await prisma.auditEvent.findMany({
    where: { tenantCompanyId: auth.companyId, createdAt: { gte: params.from, lt: params.to } },
    orderBy: { createdAt: "asc" },
    take: AUDIT_EXPORT_MAX_ROWS,
  });
  const actorIds = [...new Set(events.map((e) => e.actorUserId).filter((v): v is string => !!v))];
  const actors = new Map(
    (await prisma.userAccount.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).map((a) => [a.id, a.name])
  );
  const rows = events.map((e) => ({
    id: e.id,
    createdAt: e.createdAt.toISOString(),
    actorUserId: e.actorUserId,
    actorName: e.actorUserId ? (actors.get(e.actorUserId) ?? "（退会済み）") : "システム",
    action: e.action,
    actionLabel: AUDIT_ACTION_LABELS[e.action] ?? e.action,
    targetType: e.targetType,
    targetLabel: e.targetType ? (AUDIT_TARGET_LABELS[e.targetType] ?? e.targetType) : null,
    targetId: e.targetId,
    metadata: e.metadata,
  }));
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "AuditLogExported",
    targetType: "Company",
    targetId: auth.companyId,
    metadata: { from: params.from.toISOString(), to: params.to.toISOString(), format: params.format, count: rows.length, reason: params.reason ?? null },
  });
  const stamp = `${params.from.toISOString().slice(0, 10)}_${new Date(params.to.getTime() - 1).toISOString().slice(0, 10)}`;
  if (params.format === "json") {
    return { filename: `audit_${stamp}.json`, contentType: "application/json; charset=utf-8", body: JSON.stringify({ exportedAt: new Date().toISOString(), count: rows.length, items: rows }, null, 2), count: rows.length };
  }
  const csv = toCsv([
    ["日時(UTC)", "操作者", "操作", "操作コード", "対象", "対象ID", "詳細"],
    ...rows.map((r) => [r.createdAt, r.actorName, r.actionLabel, r.action, r.targetLabel ?? "", r.targetId ?? "", formatAuditMetadata(r.metadata).join(" / ")]),
  ]);
  return { filename: `audit_${stamp}.csv`, contentType: "text/csv; charset=utf-8", body: csv, count: rows.length };
}

// ---- 月次送付（リンクは署名付き・7日間有効・ログイン必須）----

const secret = () => process.env.SESSION_SECRET || "sesmatch-dev-secret";
const sign = (payload: string) => createHmac("sha256", `audit-export:${secret()}`).update(payload).digest("base64url");

export function monthlyExportToken(companyId: string, month: string, exp = Date.now() + MONTHLY_LINK_TTL_MS): string {
  const payload = Buffer.from(JSON.stringify({ companyId, month, exp })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyMonthlyExportToken(token: string | undefined, companyId: string, now = Date.now()): { month: string } | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const a = Buffer.from(token.slice(dot + 1));
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { companyId: string; month: string; exp: number };
    if (parsed.companyId !== companyId || parsed.exp < now || !monthRangeJst(parsed.month)) return null;
    return { month: parsed.month };
  } catch {
    return null;
  }
}

// 毎月1日（JST）に前月分のリンクを PRO 企業の代表へ送る。既送付は監査ログで判定。戻り値は送付企業数
export async function sendMonthlyAuditExportLinks(now = new Date()): Promise<{ month: string; sent: number; skipped: number }> {
  const month = previousMonthJst(now);
  const companies = await prisma.company.findMany({ where: { status: "ACTIVE", plan: { in: ["PRO", "TRIAL"] } } });
  let sent = 0;
  let skipped = 0;
  for (const co of companies) {
    if (!hasFeature(co, "audit_export", now)) {
      skipped++;
      continue;
    }
    const already = await prisma.auditEvent.findFirst({
      where: { tenantCompanyId: co.id, action: "AuditMonthlyExportSent", metadata: { path: ["month"], equals: month } },
      select: { id: true },
    });
    if (already) {
      skipped++;
      continue;
    }
    const owners = await prisma.companyMember.findMany({
      where: { companyId: co.id, status: "ACTIVE", roles: { some: { role: "OWNER" } } },
      include: { userAccount: true },
    });
    const token = monthlyExportToken(co.id, month);
    const url = `${appBaseUrl()}/audit?month=${month}&token=${encodeURIComponent(token)}`;
    for (const m of owners) {
      await sendMail({
        to: m.userAccount.email,
        subject: `【SES DirectMatch】${month} 分の監査ログをダウンロードできます`,
        body: `${m.userAccount.name} 様（${co.name}）

PRO 版の月次監査ログ（${month} 分）の準備ができました。
以下のリンクからダウンロードできます（ログインが必要です。リンクは7日間有効）。
${url}

監査ログの閲覧・期間指定の出力は「会社マイページ > 監査」からいつでも行えます。`,
      });
    }
    await audit({ tenantCompanyId: co.id, action: "AuditMonthlyExportSent", targetType: "Company", targetId: co.id, metadata: { month, recipients: owners.length } });
    sent++;
  }
  return { month, sent, skipped };
}
