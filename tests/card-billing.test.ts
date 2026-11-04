// カード決済・監査ログ出力の純粋ロジック（PRO版仕様書 §4.14, §4.15）: 日付計算、Stripe 署名検証、月次リンクのトークン
import { describe, expect, it } from "vitest";
import { Stripe, constructStripeEvent } from "@/server/billing/stripe";
import { isLastDayOfMonthJst, isYearlyRenewalMonth, jstHour, monthKeyJst, nextMonthStartJst } from "@/server/services/card-billing";
import { monthRangeJst, monthlyExportToken, previousMonthJst, verifyMonthlyExportToken } from "@/server/services/audit-export";

describe("JST の日付計算", () => {
  it("翌月1日 0:00 JST を返す", () => {
    // 2026-11-04 10:00 JST
    expect(nextMonthStartJst(new Date("2026-11-04T01:00:00Z")).toISOString()).toBe("2026-11-30T15:00:00.000Z");
    // 2026-12-31 23:30 JST → 2027-01-01 0:00 JST（UTC では 12/31 15:00）
    expect(nextMonthStartJst(new Date("2026-12-31T14:30:00Z")).toISOString()).toBe("2026-12-31T15:00:00.000Z");
  });
  it("月末判定は JST 基準", () => {
    expect(isLastDayOfMonthJst(new Date("2026-11-30T03:00:00Z"))).toBe(true); // 11/30 12:00 JST
    expect(isLastDayOfMonthJst(new Date("2026-11-30T15:00:00Z"))).toBe(false); // 12/1 0:00 JST
    expect(isLastDayOfMonthJst(new Date("2026-11-29T15:00:00Z"))).toBe(true); // 11/30 0:00 JST
    expect(jstHour(new Date("2026-11-30T03:00:00Z"))).toBe(12);
    expect(monthKeyJst(new Date("2026-11-30T15:00:00Z"))).toBe("2026-12");
  });
  it("年払いの更新月（開始翌月を1か月目として12か月ごと）", () => {
    const started = new Date("2026-11-10T00:00:00Z");
    expect(isYearlyRenewalMonth(started, "2026-12")).toBe(true);
    expect(isYearlyRenewalMonth(started, "2027-01")).toBe(false);
    expect(isYearlyRenewalMonth(started, "2027-12")).toBe(true);
    expect(isYearlyRenewalMonth(started, "2026-11")).toBe(false);
  });
});

describe("Stripe Webhook の署名検証", () => {
  const secret = "whsec_test_secret";
  const payload = JSON.stringify({ id: "evt_1", object: "event", type: "invoice.paid", data: { object: { id: "in_1", object: "invoice" } } });
  it("正しい署名ならイベントを返す", () => {
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    const ev = constructStripeEvent(payload, header, secret);
    expect(ev?.type).toBe("invoice.paid");
  });
  it("署名違い・改ざん・ヘッダ無しは null", () => {
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(constructStripeEvent(payload, header, "whsec_other")).toBeNull();
    expect(constructStripeEvent(payload.replace("in_1", "in_2"), header, secret)).toBeNull();
    expect(constructStripeEvent(payload, undefined, secret)).toBeNull();
  });
});

describe("監査ログの月次リンク", () => {
  it("月の範囲（JST）と前月", () => {
    expect(monthRangeJst("2026-11")).toEqual({ from: new Date("2026-10-31T15:00:00Z"), to: new Date("2026-11-30T15:00:00Z") });
    expect(monthRangeJst("2026-13")).toBeNull();
    expect(previousMonthJst(new Date("2026-11-30T15:30:00Z"))).toBe("2026-11"); // 12/1 0:30 JST
    expect(previousMonthJst(new Date("2026-01-05T00:00:00Z"))).toBe("2025-12");
  });
  it("トークンは企業・期限に束縛される", () => {
    const t = monthlyExportToken("c1", "2026-10");
    expect(verifyMonthlyExportToken(t, "c1")).toEqual({ month: "2026-10" });
    expect(verifyMonthlyExportToken(t, "c2")).toBeNull();
    expect(verifyMonthlyExportToken(t + "x", "c1")).toBeNull();
    expect(verifyMonthlyExportToken(monthlyExportToken("c1", "2026-10", Date.now() - 1), "c1")).toBeNull();
  });
});
