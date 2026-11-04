// スキルシート再生成の純粋ロジック（PRO版仕様書 §4.7）: Excel 行の組み立てと生成
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { BUILTIN_TEMPLATES, renderXlsx, sheetToWorkbookRows, type SheetModel } from "@/server/services/skill-sheet";

const model = (mode: "anonymous" | "named"): SheetModel => ({
  template: BUILTIN_TEMPLATES[0],
  mode,
  companyName: "株式会社テスト",
  generatedAt: new Date("2026-11-04T00:00:00Z"),
  engineer: {
    code: "E000001",
    name: mode === "named" ? "実名 太郎" : null,
    ageBand: "30代前半",
    affiliation: "自社社員",
    residenceCity: "東京都",
    availableFrom: "2026-12-01",
    rate: mode === "named" ? "700,000円" : "70〜80万円",
    remote: "週2〜3出社",
    maxOnsiteDaysPerWeek: 3,
    summary: "Java 10年",
    skills: [{ category: "言語", name: "Java", months: 120 }],
    processes: ["設計", "開発"],
    roles: ["PL"],
    industries: ["金融"],
  },
});

describe("sheetToWorkbookRows", () => {
  it("匿名版は氏名行を持たず単価帯、実名版は氏名と実額を含む", () => {
    const anon = sheetToWorkbookRows(model("anonymous")).map((r) => r.join("|")).join("\n");
    expect(anon).not.toContain("氏名");
    expect(anon).toContain("単価帯|70〜80万円");
    expect(anon).toContain("技術者経歴書");
    const named = sheetToWorkbookRows(model("named")).map((r) => r.join("|")).join("\n");
    expect(named).toContain("氏名|実名 太郎");
    expect(named).toContain("希望単価|700,000円");
  });
  it("テンプレートの表示項目に従う（簡易は役割・業種を出さない）", () => {
    const m = { ...model("anonymous"), template: BUILTIN_TEMPLATES[1] };
    const text = sheetToWorkbookRows(m).map((r) => r.join("|")).join("\n");
    expect(text).not.toContain("役割");
    expect(text).not.toContain("業種経験");
    expect(text).toContain("工程|設計 / 開発");
  });
});

describe("renderXlsx", () => {
  it("読み戻せる xlsx を生成する", () => {
    const buf = renderXlsx(model("anonymous"));
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    expect(rows[0][0]).toBe("技術者経歴書");
    expect(JSON.stringify(rows)).toContain("E000001");
  });
});
