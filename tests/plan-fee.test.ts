// PRO 版 月額利用料の純粋ロジック（PRO版仕様書 §2, §6, §13）
import { describe, expect, it } from "vitest";
import { calcPlanInvoice, dueDateOf, invoiceNumberOf, isBillableMonth, monthKey } from "@/server/billing/plan-fee";

const base = {
  plan: "PRO" as const,
  billingCycle: "MONTHLY" as const,
  paymentMethod: "INVOICE" as const,
  planSeats: 5,
  activeMembers: 5,
  planStartedAt: new Date("2026-10-15T00:00:00Z"),
};

describe("calcPlanInvoice", () => {
  it("開始当月は無料、翌月から 39,800円＋税（切り捨て）", () => {
    expect(calcPlanInvoice({ ...base, month: "2026-10" })).toBeNull();
    expect(calcPlanInvoice({ ...base, month: "2026-11" })).toEqual({
      baseYen: 39_800,
      extraSeats: 0,
      extraYen: 0,
      amountExTaxYen: 39_800,
      taxYen: 3_980,
      totalYen: 43_780,
    });
  });
  it("追加担当者は 1名 4,000円。席数以下なら加算なし", () => {
    expect(calcPlanInvoice({ ...base, activeMembers: 8, month: "2026-11" })).toMatchObject({ extraSeats: 3, extraYen: 12_000, amountExTaxYen: 51_800, taxYen: 5_180 });
    expect(calcPlanInvoice({ ...base, activeMembers: 2, month: "2026-11" })?.extraSeats).toBe(0);
  });
  it("TRIAL・FREE・カード決済・開始日なしは対象外", () => {
    expect(calcPlanInvoice({ ...base, plan: "TRIAL", month: "2026-11" })).toBeNull();
    expect(calcPlanInvoice({ ...base, plan: "FREE", month: "2026-11" })).toBeNull();
    expect(calcPlanInvoice({ ...base, paymentMethod: "CARD", month: "2026-11" })).toBeNull();
    expect(isBillableMonth({ ...base, planStartedAt: null, month: "2026-11" })).toBe(false);
  });
  it("年払いは更新月（開始翌月から12か月ごと）に 398,000円、他の月は追加担当者分のみ", () => {
    const yearly = { ...base, billingCycle: "YEARLY" as const };
    expect(calcPlanInvoice({ ...yearly, month: "2026-11" })?.baseYen).toBe(398_000);
    expect(calcPlanInvoice({ ...yearly, month: "2026-12" })).toBeNull(); // 追加なし → 請求なし
    expect(calcPlanInvoice({ ...yearly, activeMembers: 6, month: "2026-12" })).toMatchObject({ baseYen: 0, extraYen: 4_000, amountExTaxYen: 4_000 });
    expect(calcPlanInvoice({ ...yearly, month: "2027-11" })?.baseYen).toBe(398_000);
    expect(calcPlanInvoice({ ...yearly, month: "2027-10" })).toBeNull();
  });
  it("支払期限は翌月末、請求書番号は P-YYYYMM-NNNN、monthKey は UTC 基準", () => {
    expect(dueDateOf("2026-11").toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(dueDateOf("2026-12").toISOString().slice(0, 10)).toBe("2027-01-31");
    expect(dueDateOf("2027-01").toISOString().slice(0, 10)).toBe("2027-02-28");
    expect(invoiceNumberOf("2026-11", 7)).toBe("P-202611-0007");
    expect(monthKey(new Date("2026-10-31T23:00:00Z"))).toBe("2026-10");
  });
});
