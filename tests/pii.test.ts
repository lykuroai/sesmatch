// PII匿名化のテスト（§11, §25, §34: PII匿名化前のLLM呼出し停止）
import { describe, expect, it } from "vitest";
import { maskPii, verifyMasked } from "@/server/pipeline/pii";
import { rateBand, ageBandLabel } from "@/lib/constants";

describe("maskPii", () => {
  it("メールアドレスをマスクし置換表に記録する", () => {
    const { masked, tokens } = maskPii("連絡先: taro@example.com まで");
    expect(masked).not.toContain("taro@example.com");
    expect(masked).toContain("[PII_EMAIL_1]");
    expect(tokens).toContainEqual(
      expect.objectContaining({ kind: "EMAIL", originalValue: "taro@example.com" })
    );
  });

  it("電話番号をマスクする", () => {
    const { masked } = maskPii("TEL: 090-1234-5678");
    expect(masked).not.toContain("090-1234-5678");
  });

  it("ラベル付き氏名をマスクする", () => {
    const { masked, tokens } = maskPii("氏名: 山田太郎\nスキル: Java");
    expect(masked).not.toContain("山田太郎");
    expect(tokens.some((t) => t.kind === "NAME")).toBe(true);
    expect(masked).toContain("Java"); // 技術情報は残す
  });

  it("住所番地をマスクし市区町村は残す（§13）", () => {
    const { masked } = maskPii("東京都新宿区西新宿2丁目8-1 在住");
    expect(masked).not.toContain("2丁目8-1");
    expect(masked).toContain("新宿区");
  });

  it("同一値には同一トークンを割り当てる", () => {
    const { masked } = maskPii("a@ex.com と a@ex.com");
    const m = masked.match(/\[PII_EMAIL_1\]/g);
    expect(m?.length).toBe(2);
  });

  it("企業名をマスクする（§11.1）", () => {
    const { masked, tokens } = maskPii("株式会社デルタ商事の担当です。デルタ商事株式会社とも表記します。");
    expect(masked).not.toContain("株式会社デルタ商事");
    expect(tokens.some((t) => t.kind === "COMPANY")).toBe(true);
  });

  it("行頭の宛名（〇〇様）をマスクし、「仕様」「お客様」は誤検知しない", () => {
    const { masked } = maskPii("田中様\n\n仕様書とお客様向け資料を送ります。");
    expect(masked).not.toMatch(/^田中様/);
    expect(masked).toContain("仕様書");
    expect(masked).toContain("お客様");
  });
});

describe("verifyMasked（匿名化検査 §25.3）", () => {
  it("マスク済みテキストは検査を通過する", () => {
    const { masked } = maskPii("連絡先: taro@example.com / 090-1234-5678");
    expect(verifyMasked(masked).ok).toBe(true);
  });

  it("残存PIIを検出する", () => {
    const result = verifyMasked("生のメール raw@example.com が残っている");
    expect(result.ok).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
  });
});

describe("開示レベル表示（§10 Level 1）", () => {
  it("単価は10万円幅の帯で表示する", () => {
    expect(rateBand(650_000)).toBe("60〜70万円");
    expect(rateBand(700_000)).toBe("70〜80万円");
  });

  it("年代は5歳刻みで表示する", () => {
    expect(ageBandLabel(35)).toBe("35〜39歳");
  });
});
