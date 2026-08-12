import { describe, expect, it } from "vitest";
import { cleanOcrText } from "../src/server/pipeline/ocr";

// tesseract 日本語出力の整形（文字間スペース除去）の純粋ロジック
describe("cleanOcrText", () => {
  it("日本語文字間の不要なスペースを除去する", () => {
    expect(cleanOcrText("氏 名 ： 山 田 太 郎")).toBe("氏名：山田太郎");
  });

  it("英単語間のスペースは保持し、日本語と数字の間は詰める", () => {
    expect(cleanOcrText("Java Spring Boot 経 験 5 年")).toBe("Java Spring Boot 経験5年");
  });

  it("行末スペースと3行以上の空行を詰める", () => {
    expect(cleanOcrText("案件 \n\n\n\n単価")).toBe("案件\n\n単価");
  });

  it("前後の空白を除去する", () => {
    expect(cleanOcrText("  スキル  \n")).toBe("スキル");
  });

  it("丸数字の誤認識を通常の数字へ正規化する", () => {
    expect(cleanOcrText("⑳②⑥ 年 ⑨ 月 ① 日")).toBe("2026年9月1日");
    expect(cleanOcrText("単 価 ： ⑥⑤ 万 円")).toBe("単価：65万円");
  });
});
