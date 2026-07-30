// エントリー状態遷移・双方承認ロジックのテスト（§20, §34）
import { describe, expect, it } from "vitest";
import {
  applyApproval,
  canDecline,
  canMoveToConditions,
  canScheduleInterview,
  sideOf,
  type EntryStateInput,
} from "@/server/entries/logic";
import { detectContactInfo } from "@/server/pipeline/pii";

const entry = (over: Partial<EntryStateInput> = {}): EntryStateInput => ({
  status: "SUPPLY_APPROVED",
  supplyApprovedAt: new Date(),
  demandApprovedAt: null,
  demandCompanyId: "demand-co",
  supplyCompanyId: "supply-co",
  ...over,
});

describe("sideOf（§6.3: 立場は取引ごとに決定）", () => {
  it("需要側・供給側・当事者外を判定する", () => {
    expect(sideOf(entry(), "demand-co")).toBe("DEMAND");
    expect(sideOf(entry(), "supply-co")).toBe("SUPPLY");
    expect(sideOf(entry(), "other-co")).toBeNull();
  });
});

describe("applyApproval（§20.2, §20.3）", () => {
  it("片側承認では mutual にならない（片側承認だけでは開示しない §34）", () => {
    const r = applyApproval(entry({ status: "SUBMITTED", supplyApprovedAt: null }), "SUPPLY");
    expect(r).toEqual({ ok: true, nextStatus: "SUPPLY_APPROVED", mutual: false });
  });

  it("両側揃った時点で MUTUALLY_APPROVED / mutual=true になる", () => {
    const r = applyApproval(entry(), "DEMAND");
    expect(r).toEqual({ ok: true, nextStatus: "MUTUALLY_APPROVED", mutual: true });
  });

  it("同一側の二重承認は拒否する（冪等性 §34）", () => {
    const r = applyApproval(entry(), "SUPPLY");
    expect(r).toEqual({ ok: false, error: "ALREADY_APPROVED" });
  });

  it("承認可能な状態以外では拒否する", () => {
    for (const status of ["MUTUALLY_APPROVED", "DECLINED", "WITHDRAWN", "CONTRACTED"]) {
      const r = applyApproval(entry({ status }), "DEMAND");
      expect(r.ok).toBe(false);
    }
  });
});

describe("状態ガード（§20.2）", () => {
  it("面談は双方承認後のみ設定できる", () => {
    expect(canScheduleInterview("SUPPLY_APPROVED")).toBe(false);
    expect(canScheduleInterview("MUTUALLY_APPROVED")).toBe(true);
    expect(canScheduleInterview("INTERVIEW")).toBe(true);
    expect(canScheduleInterview("DECLINED")).toBe(false);
  });

  it("条件調整へは面談中のみ進められる", () => {
    expect(canMoveToConditions("INTERVIEW")).toBe(true);
    expect(canMoveToConditions("MUTUALLY_APPROVED")).toBe(false);
  });

  it("終了状態からは見送り・辞退できない", () => {
    expect(canDecline("DECLINED")).toBe(false);
    expect(canDecline("CONTRACTED")).toBe(false);
    expect(canDecline("SUBMITTED")).toBe(true);
  });
});

describe("detectContactInfo（§21: 相互承認前の連絡先検出）", () => {
  it("メール・電話・URLを検出する", () => {
    expect(detectContactInfo("私のメールは taro@example.com です")).toContain("EMAIL");
    expect(detectContactInfo("090-1234-5678 に電話ください")).toContain("PHONE");
    expect(detectContactInfo("詳細は https://example.com/x へ")).toContain("URL");
  });

  it("全角・空白挿入による回避表現を検出する（§21）", () => {
    expect(detectContactInfo("ｔａｒｏ＠ｅｘａｍｐｌｅ．ｃｏｍ")).toContain("EMAIL");
    expect(detectContactInfo("0 9 0 - 1 2 3 4 - 5 6 7 8")).toContain("PHONE");
  });

  it("連絡先を含まない業務連絡は通す", () => {
    expect(detectContactInfo("面談候補日は来週火曜14時でいかがでしょうか。")).toEqual([]);
    expect(detectContactInfo("単価は70万円を希望します。経験はJava 5年です。")).toEqual([]);
  });
});
