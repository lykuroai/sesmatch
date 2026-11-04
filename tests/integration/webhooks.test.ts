// Slack/Teams Webhook（PRO版仕様書 §4.9, §13）の統合テスト。専用DB sesmatch_test に対して実行する。
// 外部送信は fetch をモックする
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { prisma } from "@/server/db";
import { makeCompany, setPlan, truncateAll } from "./helpers";
import { createWebhook, deliverToWebhook, listWebhooks, updateWebhook } from "@/server/services/webhooks";
import { decryptString } from "@/server/crypto";

vi.mock("@/server/mail", () => ({ appBaseUrl: () => "http://test.local", sendMail: async () => {} }));

const calls: { url: string; body: string }[] = [];
let respondStatus = 200;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  await truncateAll();
  calls.length = 0;
  respondStatus = 200;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    return new Response("", { status: respondStatus });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Webhook", () => {
  it("基本版は PLAN_REQUIRED。PRO は https のみ・内部宛不可・5件まで。URL は暗号化され末尾だけ返る", async () => {
    const free = await makeCompany("Webhook基本版株式会社");
    const r = await createWebhook(free, { name: "x", url: "https://hooks.slack.com/services/a/b/c", provider: "SLACK", events: ["entry.received"] });
    expect("error" in r && r.error?.code).toBe("PLAN_REQUIRED");
    const pro = await setPlan(await makeCompany("WebhookPRO株式会社"), "PRO");
    expect("error" in (await createWebhook(pro, { name: "x", url: "http://hooks.slack.com/x", provider: "SLACK", events: ["entry.received"] }))).toBe(true);
    expect("error" in (await createWebhook(pro, { name: "x", url: "https://192.168.1.5/x", provider: "GENERIC", events: ["entry.received"] }))).toBe(true);
    for (let i = 0; i < 5; i++) {
      const c = await createWebhook(pro, { name: `h${i}`, url: `https://hooks.slack.com/services/T/B/secret${i}`, provider: "SLACK", events: ["entry.received"] });
      expect("ok" in c && c.ok).toBe(true);
    }
    const sixth = await createWebhook(pro, { name: "6", url: "https://hooks.slack.com/services/T/B/x", provider: "SLACK", events: ["entry.received"] });
    expect("error" in sixth && sixth.error?.code).toBe("PLAN_LIMIT_EXCEEDED");
    const list = await listWebhooks(pro);
    expect(list).toHaveLength(5);
    expect(list[0].urlHint).toBe("…ecret0");
    expect(JSON.stringify(list)).not.toContain("hooks.slack.com");
    const row = await prisma.webhook.findFirstOrThrow({ where: { name: "h0" } });
    expect(row.urlEncrypted).not.toContain("hooks.slack.com");
    expect(decryptString(row.urlEncrypted)).toBe("https://hooks.slack.com/services/T/B/secret0");
  });

  it("配信は Level 1 のみの本文で、失敗を数え、連続10回で停止し、再開できる", async () => {
    const pro = await setPlan(await makeCompany("配信PRO株式会社"), "PRO");
    const c = await createWebhook(pro, { name: "s", url: "https://hooks.slack.com/services/T/B/C", provider: "SLACK", events: ["entry.received"] });
    const hookId = (c as { id?: string }).id;
    if (!hookId) throw new Error("create");
    const ok = await deliverToWebhook(hookId, { event: "entry.received", title: "商談申込み", text: "案件「A」 × 人材 E000001", url: "http://test.local/entries/1" }, { retryDelays: [] });
    expect(ok).toEqual({ ok: true, attempts: 1, suspended: false });
    expect(calls[0].url).toBe("https://hooks.slack.com/services/T/B/C");
    expect(JSON.parse(calls[0].body).text).toContain("E000001");

    respondStatus = 500;
    for (let i = 1; i <= 9; i++) {
      const r = await deliverToWebhook(hookId, { event: "entry.received", title: "t", text: "x", url: "u" }, { retryDelays: [0] });
      expect(r.ok).toBe(false);
      expect(r.attempts).toBe(2); // 再試行1回
      expect(r.suspended).toBe(false);
    }
    const tenth = await deliverToWebhook(hookId, { event: "entry.received", title: "t", text: "x", url: "u" }, { retryDelays: [] });
    expect(tenth.suspended).toBe(true);
    expect((await listWebhooks(pro))[0]).toMatchObject({ status: "SUSPENDED", failCount: 10 });
    // 停止中は送らない
    const before = calls.length;
    await deliverToWebhook(hookId, { event: "entry.received", title: "t", text: "x", url: "u" }, { retryDelays: [] });
    expect(calls.length).toBe(before);
    // 再開
    await updateWebhook(pro, hookId, { resume: true });
    expect((await listWebhooks(pro))[0]).toMatchObject({ status: "ACTIVE", failCount: 0 });
  });
});
