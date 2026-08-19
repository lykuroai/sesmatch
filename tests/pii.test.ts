// 取込まわりの純関数テスト。
// 取込時のPII匿名化・LLM送信禁止は2026-08-19に全面撤廃（§25.2）。マスキング関連の
// テストは削除し、連絡先検出（§21）のテストは tests/entries.test.ts に置く。
import { describe, expect, it } from "vitest";
import { truncateFilenameBytes } from "@/server/pipeline/ingest";
import { rateBand, ageBandLabel } from "@/lib/constants";
import { MockLlmGateway } from "@/server/pipeline/llm";

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

describe("氏名の抽出（§25.2 撤廃後: LLMの抽出対象。モック実装で検証）", () => {
  const gateway = new MockLlmGateway();

  it("氏名ラベルの記載から氏名を抽出する", async () => {
    const d = await gateway.extract("氏名: 山田 太郎\nスキル: Java 5年", "ENGINEER_SHEET");
    expect(d.kind === "ENGINEER_SHEET" && d.name).toBe("山田 太郎");
  });

  it("文字間空白のラベル（氏　名）とラテン文字混じりの氏名を抽出する（履歴書のCSV変換書式）", async () => {
    const d = await gateway.extract("フリガナ,コ,性別,国籍\n氏　名,顧　YF,男,中国", "ENGINEER_SHEET");
    expect(d.kind === "ENGINEER_SHEET" && d.name).toBe("顧　YF");
  });

  it("Word表の抽出書式（ラベル単独行→次行が値）から氏名を抽出する", async () => {
    const text = "技術者経歴書\n\n氏　名\n\n顧　YF\n\n国 籍\n\n中国\n\n希望単価70万\nJava 5年";
    const d = await gateway.extract(text, "ENGINEER_SHEET");
    expect(d.kind === "ENGINEER_SHEET" && d.name).toBe("顧　YF");
  });

  it("氏名の記載がなければ null", async () => {
    const d = await gateway.extract("スキルシート\nJava 5年 希望単価70万", "ENGINEER_SHEET");
    expect(d.kind === "ENGINEER_SHEET" && d.name).toBeNull();
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
