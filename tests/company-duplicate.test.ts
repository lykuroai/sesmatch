import { describe, expect, it } from "vitest";
import {
  judgeCompanyDuplicate,
  normalizeAddress,
  normalizeCompanyName,
  registryJurisdiction,
} from "../src/server/services/company-duplicate";

describe("normalizeCompanyName", () => {
  it("法人格の前株・後株・略記を同一視する", () => {
    expect(normalizeCompanyName("株式会社ABC")).toBe("abc");
    expect(normalizeCompanyName("ABC株式会社")).toBe("abc");
    expect(normalizeCompanyName("㈱ABC")).toBe("abc");
    expect(normalizeCompanyName("（株）ABC")).toBe("abc");
  });

  it("全角英数・大文字小文字・空白のゆれを吸収する", () => {
    expect(normalizeCompanyName("ＡＢＣ 株式会社")).toBe("abc");
    expect(normalizeCompanyName("abc")).toBe("abc");
    expect(normalizeCompanyName("合同会社 テック ラボ")).toBe("テックラボ");
  });

  it("異なる企業名は区別する", () => {
    expect(normalizeCompanyName("株式会社ABC")).not.toBe(normalizeCompanyName("株式会社ABCD"));
  });
});

describe("normalizeAddress", () => {
  it("丁目・番地・号とハイフン表記を同一視する", () => {
    expect(normalizeAddress("東京都台東区上野１丁目１番１号")).toBe(
      normalizeAddress("東京都台東区上野1-1-1")
    );
  });

  it("漢数字の丁目を同一視する", () => {
    expect(normalizeAddress("東京都台東区上野一丁目1番1号")).toBe(
      normalizeAddress("東京都台東区上野1-1-1")
    );
  });

  it("全角ハイフン・長音のゆれを吸収する", () => {
    expect(normalizeAddress("東京都港区芝１−２−３")).toBe(normalizeAddress("東京都港区芝1-2-3"));
  });

  it("異なる住所は区別する", () => {
    expect(normalizeAddress("東京都台東区上野1-1-1")).not.toBe(
      normalizeAddress("東京都台東区上野1-1-2")
    );
  });
});

describe("registryJurisdiction", () => {
  it("所在地から都道府県を抽出する", () => {
    expect(registryJurisdiction("東京都台東区上野1-1-1")).toBe("東京都");
    expect(registryJurisdiction("大阪府大阪市北区梅田1-1")).toBe("大阪府");
    expect(registryJurisdiction("北海道札幌市中央区北1条西2丁目")).toBe("北海道");
  });

  it("都道府県名がなければ null", () => {
    expect(registryJurisdiction("台東区上野1-1-1")).toBeNull();
    expect(registryJurisdiction(null)).toBeNull();
    expect(registryJurisdiction(undefined)).toBeNull();
  });
});

describe("judgeCompanyDuplicate", () => {
  const existing = [
    { name: "株式会社ABC", address: "東京都台東区上野1-1-1" },
    { name: "テスト合同会社", address: "大阪府大阪市北区梅田2-2-2" },
  ];

  it("同名（表記ゆれ含む）＋同一管轄（都道府県）→ NG", () => {
    const r = judgeCompanyDuplicate(
      { name: "ＡＢＣ 株式会社", address: "東京都新宿区西新宿3-3-3" },
      existing
    );
    expect(r.level).toBe("ng");
    expect(r.matchedName).toBe("株式会社ABC");
  });

  it("同名でも管轄（都道府県）が異なる → 警告（社名一致）", () => {
    const r = judgeCompanyDuplicate(
      { name: "㈱ABC", address: "福岡県福岡市博多区4-4-4" },
      existing
    );
    expect(r.level).toBe("warning");
    expect(r.matchedField).toBe("name");
    expect(r.matchedName).toBe("株式会社ABC");
  });

  it("所在地のみ一致 → 警告（所在地一致）", () => {
    const r = judgeCompanyDuplicate(
      { name: "株式会社まったく別の会社", address: "東京都台東区上野１丁目１番１号" },
      existing
    );
    expect(r.level).toBe("warning");
    expect(r.matchedField).toBe("address");
    expect(r.matchedName).toBe("株式会社ABC");
  });

  it("同名＋所在地一致（都道府県表記なし同士でも）→ NG", () => {
    const r = judgeCompanyDuplicate(
      { name: "ABC株式会社", address: "東京都台東区上野1-1-1" },
      existing
    );
    expect(r.level).toBe("ng");
  });

  it("社名も所在地も一致しない → OK", () => {
    const r = judgeCompanyDuplicate(
      { name: "株式会社XYZ", address: "愛知県名古屋市中区栄5-5-5" },
      existing
    );
    expect(r.level).toBe("ok");
  });

  it("申込側に所在地がない場合は社名一致でも警告どまり", () => {
    const r = judgeCompanyDuplicate({ name: "株式会社ABC" }, existing);
    expect(r.level).toBe("warning");
    expect(r.matchedField).toBe("name");
  });
});
