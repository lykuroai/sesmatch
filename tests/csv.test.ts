import { describe, expect, it } from "vitest";
import { csvToCompanyRows, parseCsv } from "@/lib/csv";

describe("parseCsv", () => {
  it("基本のカンマ区切りと改行を分解する", () => {
    expect(parseCsv("a,b,c\nd,e,f")).toEqual([
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
  });

  it("CRLF・末尾改行・空行を扱う", () => {
    expect(parseCsv("a,b\r\nc,d\r\n\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("引用符内のカンマ・改行・\"\" エスケープを扱う", () => {
    expect(parseCsv('"株式会社,テスト","山田 ""太郎""","1行目\n2行目"')).toEqual([
      ['株式会社,テスト', '山田 "太郎"', "1行目\n2行目"],
    ]);
  });

  it("先頭の BOM を除去する", () => {
    expect(parseCsv("\uFEFF企業名,種別\nA社,法人")).toEqual([
      ["企業名", "種別"],
      ["A社", "法人"],
    ]);
  });
});

describe("csvToCompanyRows", () => {
  it("3列形式（企業名, 営業担当者, メールアドレス）をヘッダで判定する", () => {
    const rows = csvToCompanyRows(
      parseCsv(
        "企業名,営業担当者,メールアドレス\nラーニンギフト株式会社,B.K,request04@learningift.com\n株式会社Ksync,ご担当者 様,ses_send@k-sync.com"
      )
    );
    expect(rows).toEqual([
      {
        companyName: "ラーニンギフト株式会社",
        companyType: "CORPORATION",
        corporateNumber: undefined,
        ownerName: "B.K",
        email: "request04@learningift.com",
      },
      {
        companyName: "株式会社Ksync",
        companyType: "CORPORATION",
        corporateNumber: undefined,
        ownerName: "ご担当者 様",
        email: "ses_send@k-sync.com",
      },
    ]);
  });

  it("5列形式は列名から種別・法人番号を拾う", () => {
    const rows = csvToCompanyRows(
      parseCsv("企業名,種別,法人番号,オーナー名,メールアドレス\nA社,個人,,佐藤,a@example.com\nB社,法人,1234567890123,鈴木,b@example.com")
    );
    expect(rows[0].companyType).toBe("SOLE_PROPRIETOR");
    expect(rows[0].corporateNumber).toBeUndefined();
    expect(rows[1].companyType).toBe("CORPORATION");
    expect(rows[1].corporateNumber).toBe("1234567890123");
  });

  it("ヘッダなしの場合は列数で判定する（3列）", () => {
    const rows = csvToCompanyRows(parseCsv("C社,田中,c@example.com"));
    expect(rows).toEqual([
      {
        companyName: "C社",
        companyType: "CORPORATION",
        corporateNumber: undefined,
        ownerName: "田中",
        email: "c@example.com",
      },
    ]);
  });

  it("ヘッダなし5列は従来の列順で読む", () => {
    const rows = csvToCompanyRows(parseCsv("D社,法人,9999999999999,高橋,d@example.com"));
    expect(rows[0]).toMatchObject({
      companyName: "D社",
      companyType: "CORPORATION",
      corporateNumber: "9999999999999",
      ownerName: "高橋",
      email: "d@example.com",
    });
  });
});
