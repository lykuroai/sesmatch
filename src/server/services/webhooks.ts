// Slack／Teams Webhook 通知（PRO版仕様書 §4.9）
//
// - Incoming Webhook URL を5件/社まで登録し、通知するイベントを選ぶ
// - 本文は Level 1 の範囲（件名・匿名カード相当・コンソールへのリンク）。氏名・実額単価・メッセージ本文は含めない
// - 失敗時は3回まで再試行（1分・5分・30分）。連続10回失敗で停止し、代表へメール通知する
// - URL は暗号化して保存し、画面では末尾のみ表示する
// - 企業が PRO でなくなった場合は配信しない（設定は保持）

import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/auth/session";
import { effectivePlan, hasFeature } from "@/server/plan/features";
import { assertLimit } from "@/server/plan/limits";
import { decryptString, encryptString } from "@/server/crypto";
import { sendMail, appBaseUrl } from "@/server/mail";

export const WEBHOOK_EVENTS = [
  "alert.new", // 新着アラート（保存検索）
  "entry.received", // 商談申込み受信
  "entry.approved", // 双方承認（商談開始）
  "interview.scheduled", // 面談設定
  "message.received", // メッセージ受信
  "contract.sign_requested", // 契約署名依頼（条件確認書の作成）
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  "alert.new": "新着アラート",
  "entry.received": "商談申込みの受信",
  "entry.approved": "双方承認（商談開始）",
  "interview.scheduled": "面談の設定",
  "message.received": "メッセージの受信",
  "contract.sign_requested": "契約（条件確認書）の署名依頼",
};

export const MAX_FAILURES_BEFORE_SUSPEND = 10;
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];

export type WebhookPayload = { event: WebhookEvent; title: string; text: string; url: string };

// 送信本文（純粋関数）。Slack/Teams は text、GENERIC は構造化 JSON
export function formatWebhookBody(provider: "SLACK" | "TEAMS" | "GENERIC", p: WebhookPayload, occurredAt = new Date()): string {
  const line = `【SES DirectMatch】${p.title}\n${p.text}\n${p.url}`;
  if (provider === "SLACK") return JSON.stringify({ text: line });
  if (provider === "TEAMS") return JSON.stringify({ text: line.replace(/\n/g, "<br>") });
  return JSON.stringify({ event: p.event, title: p.title, text: p.text, url: p.url, occurredAt: occurredAt.toISOString() });
}

const urlHintOf = (url: string) => `…${url.slice(-6)}`;

function validateUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return "URL は https で始まる必要があります";
    if (["localhost", "127.0.0.1", "0.0.0.0"].includes(u.hostname) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname))
      return "内部ネットワーク宛の URL は登録できません";
    return null;
  } catch {
    return "URL の形式が不正です";
  }
}

export async function listWebhooks(auth: AuthContext) {
  const items = await prisma.webhook.findMany({ where: { tenantCompanyId: auth.companyId }, orderBy: { createdAt: "asc" } });
  return items.map((w) => ({
    id: w.id,
    name: w.name,
    urlHint: w.urlHint,
    provider: w.provider,
    events: w.events as WebhookEvent[],
    status: w.status,
    failCount: w.failCount,
    lastDeliveredAt: w.lastDeliveredAt,
    lastErrorAt: w.lastErrorAt,
    lastError: w.lastError,
  }));
}

export async function createWebhook(auth: AuthContext, input: { name: string; url: string; provider: "SLACK" | "TEAMS" | "GENERIC"; events: WebhookEvent[] }) {
  const gate = { error: undefined as undefined | { code: string; message?: string } };
  if (!hasFeature(auth, "webhook_notify")) return { error: { code: "PLAN_REQUIRED", message: "この機能は PRO 版でご利用いただけます" } };
  const bad = validateUrl(input.url);
  if (bad) return { error: { code: "VALIDATION_ERROR", message: bad } };
  const count = await prisma.webhook.count({ where: { tenantCompanyId: auth.companyId } });
  const limit = assertLimit(auth.plan, "webhooks", count);
  if (limit) return limit;
  void gate;
  const w = await prisma.webhook.create({
    data: {
      tenantCompanyId: auth.companyId,
      name: input.name.trim().slice(0, 50) || "通知先",
      urlEncrypted: encryptString(input.url),
      urlHint: urlHintOf(input.url),
      provider: input.provider,
      events: input.events,
      createdByMemberId: auth.memberId,
    },
  });
  await audit({ tenantCompanyId: auth.companyId, actorUserId: auth.userAccountId, action: "WebhookCreated", targetType: "Webhook", targetId: w.id, metadata: { provider: input.provider, events: input.events } });
  return { ok: true, id: w.id };
}

export async function updateWebhook(
  auth: AuthContext,
  id: string,
  input: { name?: string; url?: string; provider?: "SLACK" | "TEAMS" | "GENERIC"; events?: WebhookEvent[]; resume?: boolean }
) {
  const w = await prisma.webhook.findFirst({ where: { id, tenantCompanyId: auth.companyId } });
  if (!w) return { error: { code: "NOT_FOUND" as const } };
  if (input.url) {
    const bad = validateUrl(input.url);
    if (bad) return { error: { code: "VALIDATION_ERROR" as const, message: bad } };
  }
  await prisma.webhook.update({
    where: { id },
    data: {
      ...(input.name != null ? { name: input.name.trim().slice(0, 50) || w.name } : {}),
      ...(input.url ? { urlEncrypted: encryptString(input.url), urlHint: urlHintOf(input.url) } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.events ? { events: input.events } : {}),
      ...(input.resume ? { status: "ACTIVE", failCount: 0, lastError: null } : {}),
    },
  });
  return { ok: true };
}

export async function deleteWebhook(auth: AuthContext, id: string) {
  const w = await prisma.webhook.findFirst({ where: { id, tenantCompanyId: auth.companyId } });
  if (!w) return { error: { code: "NOT_FOUND" as const } };
  await prisma.webhook.delete({ where: { id } });
  return { ok: true };
}

// 1件へ送信（再試行込み）。戻り値は成功可否
async function postOnce(url: string, body: string, timeoutMs = 10_000): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function deliverToWebhook(
  webhookId: string,
  payload: WebhookPayload,
  opts?: { retryDelays?: number[] }
): Promise<{ ok: boolean; attempts: number; suspended: boolean }> {
  const w = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!w || w.status !== "ACTIVE") return { ok: false, attempts: 0, suspended: false };
  const url = decryptString(w.urlEncrypted);
  const body = formatWebhookBody(w.provider, payload);
  const delays = opts?.retryDelays ?? RETRY_DELAYS_MS;
  let attempts = 0;
  let last: { ok: boolean; error?: string } = { ok: false };
  for (let i = 0; i <= delays.length; i++) {
    attempts++;
    last = await postOnce(url, body);
    if (last.ok) break;
    if (i < delays.length) await sleep(delays[i]);
  }
  if (last.ok) {
    await prisma.webhook.update({ where: { id: w.id }, data: { failCount: 0, lastDeliveredAt: new Date(), lastError: null } });
    return { ok: true, attempts, suspended: false };
  }
  const failCount = w.failCount + 1;
  const suspend = failCount >= MAX_FAILURES_BEFORE_SUSPEND;
  await prisma.webhook.update({
    where: { id: w.id },
    data: { failCount, lastErrorAt: new Date(), lastError: (last.error ?? "送信失敗").slice(0, 200), ...(suspend ? { status: "SUSPENDED" } : {}) },
  });
  if (suspend) await notifySuspended(w.tenantCompanyId, w.name);
  return { ok: false, attempts, suspended: suspend };
}

async function notifySuspended(companyId: string, name: string) {
  try {
    const owners = await prisma.companyMember.findMany({
      where: { companyId, status: "ACTIVE", roles: { some: { role: "OWNER" } } },
      include: { userAccount: true },
    });
    await Promise.all(
      owners.map((m) =>
        sendMail({
          to: m.userAccount.email,
          subject: `【SES DirectMatch】Webhook「${name}」を停止しました（連続${MAX_FAILURES_BEFORE_SUSPEND}回失敗）`,
          body: `${m.userAccount.name} 様

Slack／Teams 通知先「${name}」への送信が連続${MAX_FAILURES_BEFORE_SUSPEND}回失敗したため停止しました。
URL を確認のうえ、会社マイページ > 外部通知（Webhook）から再開してください。
${appBaseUrl()}/company/webhooks`,
        })
      )
    );
  } catch (e) {
    console.error("[webhook] 停止通知の送信に失敗", e);
  }
}

// 企業の購読 Webhook すべてへ非同期配信（呼び出し元の処理を止めない）。PRO でなければ配信しない
export function dispatchWebhooks(companyId: string, payload: WebhookPayload): void {
  void (async () => {
    try {
      const company = await prisma.company.findUnique({ where: { id: companyId }, select: { plan: true, planExpiresAt: true, status: true } });
      if (!company || company.status !== "ACTIVE" || effectivePlan(company) === "FREE") return;
      const hooks = await prisma.webhook.findMany({ where: { tenantCompanyId: companyId, status: "ACTIVE" } });
      await Promise.all(
        hooks
          .filter((h) => (h.events as string[]).includes(payload.event))
          .map((h) => deliverToWebhook(h.id, payload).catch((e) => console.error(`[webhook] 配信失敗 id=${h.id}`, e)))
      );
    } catch (e) {
      console.error("[webhook] 配信処理に失敗", e);
    }
  })();
}

// テスト送信（再試行なし）
export async function testWebhook(auth: AuthContext, id: string) {
  const w = await prisma.webhook.findFirst({ where: { id, tenantCompanyId: auth.companyId } });
  if (!w) return { error: { code: "NOT_FOUND" as const } };
  const r = await deliverToWebhook(w.id, { event: "alert.new", title: "テスト通知", text: "SES DirectMatch からのテスト送信です。", url: `${appBaseUrl()}/company/webhooks` }, { retryDelays: [] });
  return { ok: r.ok, attempts: r.attempts, suspended: r.suspended };
}
