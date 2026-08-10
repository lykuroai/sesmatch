// モックLLMゲートウェイの国籍抽出（2026-08-05: 国籍・性別・年齢のLLM送信禁止を撤廃し、国籍を抽出対象に追加）
import { describe, expect, it } from "vitest";
import { MockLlmGateway, type EngineerDraft, type ProjectDraft } from "@/server/pipeline/llm";

const gateway = new MockLlmGateway();

async function extractEngineer(text: string): Promise<EngineerDraft> {
  return (await gateway.extract(text, "ENGINEER_SHEET")) as EngineerDraft;
}

async function extractProject(text: string): Promise<ProjectDraft> {
  return (await gateway.extract(text, "PROJECT_DESCRIPTION")) as ProjectDraft;
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

describe("モックLLM: 案件の勤務地抽出", () => {
  it("「勤務地：」の記載から抽出する", async () => {
    const d = await extractProject("案件名: 銀行系開発\n勤務地：東京都中野区\n単価: 75万");
    expect(d.locationCity).toBe("東京都中野区");
  });

  it("記載がなければ null", async () => {
    const d = await extractProject("案件名: 銀行系開発\n単価: 75万");
    expect(d.locationCity).toBeNull();
  });
});

describe("モックLLM: 案件の外国籍不可抽出", () => {
  it("「外国籍：不可」から不可（true）を抽出する", async () => {
    const d = await extractProject("案件名: 銀行系開発\n単価: 75万\n面談: 1回\n外国籍：不可");
    expect(d.noForeignNational).toBe(true);
  });

  it("「外国人NG」も不可（true）とする", async () => {
    const d = await extractProject("案件名: EC開発\n外国人の方はNGです\n単価: 70万");
    expect(d.noForeignNational).toBe(true);
  });

  it("「日本国籍の方のみ」も不可（true）とする", async () => {
    const d = await extractProject("案件名: 公共系\n応募条件: 日本国籍の方のみ\n単価: 80万");
    expect(d.noForeignNational).toBe(true);
  });

  it("「外国籍可」は可（false）とする", async () => {
    const d = await extractProject("案件名: Web開発\n外国籍可（N2以上）\n単価: 65万");
    expect(d.noForeignNational).toBe(false);
  });

  it("記載がなければ null（既定は可として登録される）", async () => {
    const d = await extractProject("案件名: Web開発\n単価: 65万\nJava必須");
    expect(d.noForeignNational).toBeNull();
  });
});
