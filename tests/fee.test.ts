// 成約手数料エンジンのテスト（§23, §34）
import { describe, expect, it } from "vitest";
import {
  calcFeeExTax,
  calcTax,
  decideFee,
  isWithinRefundWindow,
  MAX_CHARGEABLE_MONTHS,
} from "@/server/billing/fee";

describe("calcFeeExTax（§23: fee = floor(amount × 3 / 100)）", () => {
  it("3%を切り捨てで計算する", () => {
    expect(calcFeeExTax(700_000)).toBe(21_000);
    expect(calcFeeExTax(650_000)).toBe(19_500);
    expect(calcFeeExTax(333_333)).toBe(9_999); // 9999.99 → floor
    expect(calcFeeExTax(1)).toBe(0);
  });

  it("日割り確定額にもそのまま3%を適用する（§23 月途中）", () => {
    // 70万円の15/30日割り = 350,000円 → 10,500円
    expect(calcFeeExTax(350_000)).toBe(10_500);
  });
});

describe("decideFee（12稼働月上限 §23）", () => {
  it("1〜12稼働月目は課金する", () => {
    expect(decideFee(700_000, 0)).toEqual({ chargeableMonthIndex: 1, feeExTaxYen: 21_000, status: "CHARGED" });
    expect(decideFee(700_000, 11)).toEqual({ chargeableMonthIndex: 12, feeExTaxYen: 21_000, status: "CHARGED" });
  });

  it("13稼働月目以降は無料（§4, §23）", () => {
    expect(decideFee(700_000, 12)).toEqual({ chargeableMonthIndex: 13, feeExTaxYen: 0, status: "FREE" });
    expect(decideFee(700_000, 24)).toEqual({ chargeableMonthIndex: 25, feeExTaxYen: 0, status: "FREE" });
  });

  it("更新契約でもリセットされない（priorChargedMonths は契約を跨いだ累計 §34）", () => {
    // 旧契約で10ヶ月課金済み → 新契約の3ヶ月目（累計13稼働月目）は無料
    const renewalMonth1 = decideFee(700_000, 10); // 累計11 → 課金
    const renewalMonth2 = decideFee(700_000, 11); // 累計12 → 課金
    const renewalMonth3 = decideFee(700_000, 12); // 累計13 → 無料
    expect(renewalMonth1.status).toBe("CHARGED");
    expect(renewalMonth2.status).toBe("CHARGED");
    expect(renewalMonth3.status).toBe("FREE");
    expect(MAX_CHARGEABLE_MONTHS).toBe(12);
  });
});

describe("isWithinRefundWindow（開始後14日以内の離脱は全額返金 §23, §34）", () => {
  const start = new Date("2026-08-01T00:00:00Z");

  it("14日以内（境界含む）は返金対象", () => {
    expect(isWithinRefundWindow(start, new Date("2026-08-10T00:00:00Z"))).toBe(true);
    expect(isWithinRefundWindow(start, new Date("2026-08-15T00:00:00Z"))).toBe(true); // ちょうど14日
  });

  it("15日目以降は返金対象外", () => {
    expect(isWithinRefundWindow(start, new Date("2026-08-16T00:00:00Z"))).toBe(false);
    expect(isWithinRefundWindow(start, new Date("2026-12-01T00:00:00Z"))).toBe(false);
  });
});

describe("calcTax", () => {
  it("10%切り捨て（暫定 §36）", () => {
    expect(calcTax(21_000)).toBe(2_100);
    expect(calcTax(19_999)).toBe(1_999);
  });
});
