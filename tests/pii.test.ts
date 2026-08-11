// PII匿名化のテスト（§11, §25, §34: PII匿名化前のLLM呼出し停止）
import { describe, expect, it } from "vitest";
import { maskPii, verifyMasked } from "@/server/pipeline/pii";
import { truncateFilenameBytes } from "@/server/pipeline/ingest";
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

  it("CSV変換（カンマ区切り）・全角空白区切りの氏名もマスクする", () => {
    // Excel経歴書は sheet_to_csv でカンマ区切りになる。コロン必須だと漏れる回帰
    const csv = maskPii("氏名,山田太郎,スキル,Java");
    expect(csv.masked).not.toContain("山田太郎");
    expect(csv.masked).toContain("Java");

    const spaced = maskPii("氏名　鈴木花子");
    expect(spaced.masked).not.toContain("鈴木花子");

    const kana = maskPii("フリガナ：ヤマダ タロウ");
    expect(kana.masked).not.toContain("ヤマダ タロウ");
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

  it("残存PIIを検出する。findings には実値を含めない（平文保存防止）", () => {
    const result = verifyMasked("生のメール raw@example.com が残っている");
    expect(result.ok).toBe(false);
    expect(result.findings).toContain("EMAIL");
    // 検出結果は種別のみで、メールアドレスの実値を含まない
    expect(result.findings.join(",")).not.toContain("raw@example.com");
  });

  it("ラベル付き氏名（CSV形式）の残存も検出する", () => {
    const result = verifyMasked("氏名,山田太郎");
    expect(result.ok).toBe(false);
    expect(result.findings).toContain("NAME");
  });
});

describe("保存ファイル名のサニタイズ（パストラバーサル対策 §31）", () => {
  it("ディレクトリ区切り・親参照を除去してベース名のみにする", () => {
    const out = truncateFilenameBytes("../../../../tmp/pwn.txt", 180);
    expect(out).not.toContain("/");
    expect(out).not.toContain("..");
    expect(out.endsWith(".txt")).toBe(true);
  });

  it("バックスラッシュ・先頭ドットも無効化する", () => {
    const out = truncateFilenameBytes("..\\..\\evil.js", 180);
    expect(out).not.toContain("\\");
    expect(out.startsWith(".")).toBe(false);
  });

  it("通常のファイル名はそのまま保持する", () => {
    expect(truncateFilenameBytes("経歴書.xlsx", 180)).toBe("経歴書.xlsx");
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
