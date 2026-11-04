// Webhook の純粋ロジック（PRO版仕様書 §4.9）と暗号ユーティリティ
import { describe, expect, it } from "vitest";
import { formatWebhookBody, RETRY_DELAYS_MS, MAX_FAILURES_BEFORE_SUSPEND } from "@/server/services/webhooks";
import { decryptString, encryptString } from "@/server/crypto";

describe("formatWebhookBody", () => {
  const p = { event: "entry.received" as const, title: "商談申込み", text: "案件「A」 × 人材 E000001", url: "https://ses.example/entries/1" };
  it("Slack は text、Teams は改行を <br>、汎用は構造化 JSON", () => {
    expect(JSON.parse(formatWebhookBody("SLACK", p))).toEqual({ text: "【SES DirectMatch】商談申込み\n案件「A」 × 人材 E000001\nhttps://ses.example/entries/1" });
    expect(JSON.parse(formatWebhookBody("TEAMS", p)).text).toContain("<br>");
    const g = JSON.parse(formatWebhookBody("GENERIC", p, new Date("2026-11-04T00:00:00Z")));
    expect(g).toMatchObject({ event: "entry.received", title: "商談申込み", occurredAt: "2026-11-04T00:00:00.000Z" });
  });
  it("再試行は 1分・5分・30分の3回、停止は連続10回", () => {
    expect(RETRY_DELAYS_MS).toEqual([60_000, 300_000, 1_800_000]);
    expect(MAX_FAILURES_BEFORE_SUSPEND).toBe(10);
  });
});

describe("encryptString / decryptString", () => {
  it("往復でき、同じ平文でも毎回異なる暗号文になる", () => {
    const a = encryptString("https://hooks.slack.com/services/T/B/x");
    const b = encryptString("https://hooks.slack.com/services/T/B/x");
    expect(a).not.toBe(b);
    expect(decryptString(a)).toBe("https://hooks.slack.com/services/T/B/x");
    expect(() => decryptString("broken")).toThrow();
  });
});
