import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";

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
