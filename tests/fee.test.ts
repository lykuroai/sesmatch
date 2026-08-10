// 成約手数料エンジンのテスト（§23, §34）
import { describe, expect, it } from "vitest";
import {
  calcFeeExTax,
  calcTax,
  decideFee,
  isNewCompanyFreeMonth,
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

describe("新規企業30日間無料", () => {
  const approvedAt = new Date("2026-08-10T00:00:00Z");

  it("承認月と、月初が承認+30日以内の翌月は無料", () => {
    expect(isNewCompanyFreeMonth("2026-08", approvedAt)).toBe(true); // 承認月（月初は承認前でも無料）
    expect(isNewCompanyFreeMonth("2026-09", approvedAt)).toBe(true); // 9/1 は 9/9 以前
  });

  it("月初が承認+30日を超える月は課金", () => {
    expect(isNewCompanyFreeMonth("2026-10", approvedAt)).toBe(false);
    expect(isNewCompanyFreeMonth("2027-08", approvedAt)).toBe(false);
  });

  it("無料期間中は decideFee が FREE・0円を返す", () => {
    const d = decideFee(700_000, 0, true);
    expect(d.status).toBe("FREE");
    expect(d.feeExTaxYen).toBe(0);
    expect(d.chargeableMonthIndex).toBe(1);
  });

  it("無料月は課金枠を消費しない（priorCharged が増えないため12か月上限に影響しない）", () => {
    // 無料月の後の課金月: priorCharged はそのまま
    const d = decideFee(700_000, 0, false);
    expect(d.status).toBe("CHARGED");
    expect(d.feeExTaxYen).toBe(21_000);
  });
});
