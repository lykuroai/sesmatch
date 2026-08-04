// Claude API による LLM ゲートウェイ実装（§25）
// - 送信するのは匿名化済みテキストのみ（呼び出し側の匿名化検査を通過したもの）
// - 構造化出力（output_config.format）で JSON を強制し、zod で検証する（§9.2 JSON検証）
// - モデル・目的・トークン数を監査ログへ記録（§25.4）
// - 事業者条件（ゼロデータ保持・学習オプトアウト）は Anthropic との契約設定で担保する（§36）

import Anthropic from "@anthropic-ai/sdk";
import { ZodError } from "zod";
import { audit } from "@/server/audit";
import { summarizeZodError } from "./llm-openai";
import {
  engineerDraftSchema,
  projectDraftSchema,
  type ExtractionDraft,
  type LlmGateway,
} from "./llm";

const MODEL = "claude-opus-5";

const nullable = (type: "string" | "integer") => ({ anyOf: [{ type }, { type: "null" }] });

const CLASSIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["ENGINEER_SHEET", "PROJECT_DESCRIPTION", "UNKNOWN"] },
  },
  required: ["kind"],
} as unknown as Record<string, unknown>;

const ENGINEER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["ENGINEER_SHEET"] },
    affiliationType: {
      anyOf: [
        { type: "string", enum: ["EMPLOYEE", "AFFILIATED", "FREELANCER", "SUBTIER1"] },
        { type: "null" },
      ],
      description:
        "所属区分: EMPLOYEE=自社社員(雇用) / AFFILIATED=自社所属(業務委託) / FREELANCER=個人事業主・フリーランス / SUBTIER1=一社下(協力会社所属)。不明は null",
    },
    ageBand: { ...nullable("integer"), description: "5歳刻み年代の下限（例: 35）" },
    residenceCity: { ...nullable("string"), description: "居住市区町村" },
    availableFrom: { ...nullable("string"), description: "稼働可能日 YYYY-MM-DD" },
    desiredRateYen: { ...nullable("integer"), description: "希望月額単価（円）" },
    maxOnsiteDaysPerWeek: { ...nullable("integer"), description: "週あたり最大出社日数 0-5" },
    skills: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: {
            type: "string",
            enum: ["LANGUAGE", "FRAMEWORK", "DATABASE", "CLOUD", "OS", "TOOL", "CERTIFICATION"],
          },
          name: { type: "string" },
          months: {
            ...nullable("integer"),
            description:
              "経験月数。明記があればその値。明記がなければ、そのスキルが使用技術として登場するプロジェクトの期間だけを合算して推定する（登場しないプロジェクトは含めない。業界経験や経歴全体の年数をスキルの月数として使わない。重複期間は二重に数えない）。経歴からも判断できない場合のみ null",
          },
          monthsEstimated: {
            type: "boolean",
            description: "months を経歴からの推定で算出した場合 true（明記値をそのまま使った場合 false）",
          },
        },
        required: ["category", "name", "months", "monthsEstimated"],
      },
    },
    processes: { type: "array", items: { type: "string" }, description: "経験工程" },
    roles: {
      type: "array",
      items: { type: "string" },
      description: "経験役割（PM/PMO/PL/リーダー/テックリード/SE/PG 等。経歴から判断）",
    },
    industries: {
      type: "array",
      items: { type: "string" },
      description: "業種経験（金融/製造/EC/通信/公共/医療 等。経歴のプロジェクトから判断）",
    },
    summary: { type: "string", description: "匿名要約（200字以内・自然な日本語・PIIを含めない）" },
  },
  required: [
    "kind",
    "affiliationType",
    "ageBand",
    "residenceCity",
    "availableFrom",
    "desiredRateYen",
    "maxOnsiteDaysPerWeek",
    "skills",
    "processes",
    "roles",
    "industries",
    "summary",
  ],
} as unknown as Record<string, unknown>;

const PROJECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["PROJECT_DESCRIPTION"] },
    name: { ...nullable("string"), description: "案件名" },
    startDate: { ...nullable("string"), description: "開始日 YYYY-MM-DD" },
    rateMaxYen: { ...nullable("integer"), description: "月額単価上限（円）" },
    onsiteDaysPerWeek: { ...nullable("integer"), description: "週出社日数 0-5" },
    requiredSkills: {
      type: "array",
      items: { type: "string" },
      description:
        "必須スキル。技術要素（言語・フレームワーク・DB・クラウド・製品・技術領域）のみ、重要な順に最大5個。マッチングで完全一致・全充足が求められるため真に必須の技術だけに絞る。「資料作成」「顧客折衝」「関係者調整」等の職務要件・ソフトスキルは含めない（summary に書く）",
    },
    preferredSkills: {
      type: "array",
      items: { type: "string" },
      description: "尚可スキル。「尚可」「歓迎」とされた技術要素と、必須から溢れた技術要素",
    },
    summary: { type: "string", description: "匿名要約（自然な日本語・エンド企業名は抽象カテゴリに置換）" },
  },
  required: [
    "kind",
    "name",
    "startDate",
    "rateMaxYen",
    "onsiteDaysPerWeek",
    "requiredSkills",
    "preferredSkills",
    "summary",
  ],
} as unknown as Record<string, unknown>;

const SYSTEM_PROMPT = `あなたはSES（システムエンジニアリングサービス）業界の文書を正規化する抽出エンジンです。
入力は PII 匿名化済みのテキストで、[PII_EMAIL_1] のようなトークンを含むことがあります。
出力に PII トークンや個人を特定しうる情報（氏名・連絡先・企業実名）を含めてはいけません。
- 日付は ISO 8601（YYYY-MM-DD）で出力する
- 単価は月額の円整数で出力する（例: 70万円 → 700000）
- スキル名は一般的な正式名称に正規化する（例: "JAVA" → "Java", "railsフレームワーク" → "Rails"）
- 経験年数は月数に換算する（例: 5年 → 60）
- 判断できない項目は null にする（推測で埋めない）
- 例外: スキルの経験月数（months）に限り、明記がなければ経歴欄のプロジェクト期間から推定してよい（推定した場合は monthsEstimated=true を付ける）`;

export class ClaudeLlmGateway implements LlmGateway {
  private client = new Anthropic(); // ANTHROPIC_API_KEY を環境変数から解決

  private async call(
    purpose: string,
    schema: Record<string, unknown>,
    prompt: string,
    maxTokens: number
  ) {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: prompt }],
    });
    await audit({
      action: "LlmRequest", // §25.4: モデル・目的・日時・トークン数を監査（本文は記録しない）
      metadata: {
        provider: "anthropic",
        model: MODEL,
        purpose,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    });
    if (response.stop_reason === "refusal") throw new Error("LLMが処理を拒否しました");
    const text = response.content.find((b) => b.type === "text")?.text;
    if (!text) throw new Error("LLM出力が空です");
    return JSON.parse(text) as unknown;
  }

  async classify(maskedText: string) {
    try {
      const result = (await this.call(
        "classify",
        CLASSIFY_SCHEMA,
        `次の文書が技術者のスキルシート（ENGINEER_SHEET）か、案件募集情報（PROJECT_DESCRIPTION）か、どちらでもない（UNKNOWN）かを判定してください。\n\n---\n${maskedText}`,
        1024
      )) as { kind: "ENGINEER_SHEET" | "PROJECT_DESCRIPTION" | "UNKNOWN" };
      return result.kind;
    } catch {
      return "UNKNOWN" as const;
    }
  }

  async extract(
    maskedText: string,
    kind: "ENGINEER_SHEET" | "PROJECT_DESCRIPTION"
  ): Promise<ExtractionDraft> {
    const isEngineer = kind === "ENGINEER_SHEET";
    const instruction = isEngineer
      ? "次のスキルシートから構造化データを抽出してください。summary には技術・経験の匿名要約を200字以内の自然な日本語で書いてください（氏名・企業名・連絡先・PIIトークンを含めない）。"
      : "次の案件情報から構造化データを抽出してください。summary には業務内容の匿名要約を200字以内の自然な日本語で書いてください（エンド企業名は「大手金融機関」等の抽象カテゴリに置換する）。";
    const raw = await this.call(
      `extract:${kind}`,
      isEngineer ? ENGINEER_SCHEMA : PROJECT_SCHEMA,
      `${instruction}\n\n---\n${maskedText}`,
      16000
    );
    // JSON検証（§9.2）: スキーマ不一致は取込失敗として人手対応に回す
    try {
      return isEngineer ? engineerDraftSchema.parse(raw) : projectDraftSchema.parse(raw);
    } catch (e) {
      if (e instanceof ZodError)
        throw new Error(`LLM抽出結果のJSON検証に失敗しました（${summarizeZodError(e)}）`);
      throw e;
    }
  }
}
