// モックLLMゲートウェイの国籍抽出（2026-08-05: 国籍・性別・年齢のLLM送信禁止を撤廃し、国籍を抽出対象に追加）
import { describe, expect, it } from "vitest";
import { MockLlmGateway, type EngineerDraft } from "@/server/pipeline/llm";

const gateway = new MockLlmGateway();

async function extractEngineer(text: string): Promise<EngineerDraft> {
  return (await gateway.extract(text, "ENGINEER_SHEET")) as EngineerDraft;
}

describe("モックLLM: 国籍抽出", () => {
  it("「韓国籍」の記載から国名を抽出する", async () => {
    const d = await extractEngineer(
      "スキルシート\n氏名: CH(42歳・男性・韓国籍)\n希望単価: 85万\nJava 5年\n開発"
    );
    expect(d.nationality).toBe("韓国");
    expect(d.ageBand).toBe(40);
  });

  it("「国籍：ベトナム」のラベル形式から国名を抽出する", async () => {
    const d = await extractEngineer("スキルシート\n国籍：ベトナム\n希望単価: 60万");
    expect(d.nationality).toBe("ベトナム");
  });

  it("「外国籍」のみで国名不明の場合は「外国籍」とする", async () => {
    const d = await extractEngineer("スキルシート\n外国籍・日本語N1\n希望単価: 60万");
    expect(d.nationality).toBe("外国籍");
  });

  it("国籍の記載がなければ null（日本国籍とみなす）", async () => {
    const d = await extractEngineer("スキルシート\n氏名: 山田(35歳)\n希望単価: 70万\n弊社在籍の社員です");
    expect(d.nationality).toBeNull();
  });
});
