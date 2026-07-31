// OpenAI 互換 API（chat/completions）による LLM ゲートウェイ実装（§25）
// LiteLLM 等のプロキシ経由で任意モデルを利用する場合に使う。
// 環境変数: LLM_BASE_URL（例: https://api.lykuro.ai/v1）, LLM_MODEL, LLM_API_KEY
// - 送信するのは匿名化済みテキストのみ（呼び出し側の匿名化検査を通過したもの）
// - response_format: json_object で JSON を強制し、zod で検証する（§9.2 JSON検証）
// - モデル・目的・トークン数を監査ログへ記録（§25.4）
// - 事業者条件（ゼロデータ保持・学習オプトアウト）はプロキシ/モデル提供元との契約で担保する（§25.4, §36）

import { ZodError } from "zod";
import { audit } from "@/server/audit";
import {
  engineerDraftSchema,
  projectDraftSchema,
  type ExtractionDraft,
  type LlmGateway,
} from "./llm";

// zod エラーを人が読める1行に要約する（取込履歴に表示される）
export function summarizeZodError(e: ZodError): string {
  return e.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join(" / ");
}

const SYSTEM_PROMPT = `あなたはSES（システムエンジニアリングサービス）業界の文書を正規化する抽出エンジンです。
入力は PII 匿名化済みのテキストで、[PII_EMAIL_1] のようなトークンを含むことがあります。
出力に PII トークンや個人を特定しうる情報（氏名・連絡先・企業実名）を含めてはいけません。
- 指定された JSON スキーマに厳密に従った JSON オブジェクトのみを出力する（説明文・コードフェンス禁止）
- 日付は ISO 8601（YYYY-MM-DD）の文字列で出力する
- 単価は月額の円整数で出力する（例: 70万円 → 700000）
- スキル名は一般的な正式名称に正規化する（例: "JAVA" → "Java"）
- 経験年数は月数に換算する（例: 5年 → 60）
- 判断できない項目は null にする（推測で埋めない）
- summary などの自由記述の文字列は、必ず自然な日本語で書く（英語・中国語で出力しない）`;

const CLASSIFY_SCHEMA = `{"kind": "ENGINEER_SHEET" | "PROJECT_DESCRIPTION" | "UNKNOWN"}`;

const ENGINEER_SCHEMA = `{
  "kind": "ENGINEER_SHEET",
  "affiliationType": "EMPLOYEE" | "AFFILIATED" | "FREELANCER" | "SUBTIER1" | null,
                                       // 所属区分: 自社社員(正社員・雇用) / 自社所属(業務委託) / 個人事業主(フリーランス・弊社直個人) / 一社下(協力会社所属)。判断できなければ null
  "ageBand": number | null,            // 5歳刻み年代の下限（例: 35）
  "residenceCity": string | null,      // 居住市区町村
  "availableFrom": string | null,      // 稼働可能日 YYYY-MM-DD
  "desiredRateYen": number | null,     // 希望月額単価（円整数）
  "maxOnsiteDaysPerWeek": number | null, // 週あたり最大出社日数 0-5
  "skills": [{"category": "LANGUAGE"|"FRAMEWORK"|"DATABASE"|"CLOUD"|"OS"|"TOOL"|"CERTIFICATION", "name": string, "months": number | null}],
  "processes": string[],               // 経験工程（要件定義/基本設計/詳細設計/開発/テスト/運用/保守）
  "summary": string                    // 匿名要約200字以内。自然な日本語で書く。PII・企業名を含めない
}`;

const PROJECT_SCHEMA = `{
  "kind": "PROJECT_DESCRIPTION",
  "name": string | null,               // 案件名
  "startDate": string | null,          // 開始日 YYYY-MM-DD
  "rateMaxYen": number | null,         // 月額単価上限（円整数）
  "onsiteDaysPerWeek": number | null,  // 週出社日数 0-5
  "requiredSkills": string[],
  "preferredSkills": string[],
  "summary": string                    // 匿名要約。自然な日本語で書く。エンド企業名は「大手金融機関」等の抽象カテゴリに置換
}`;

export class OpenAiCompatGateway implements LlmGateway {
  private baseUrl = (process.env.LLM_BASE_URL ?? "").replace(/\/+$/, "");
  private model = process.env.LLM_MODEL ?? "";
  private apiKey = process.env.LLM_API_KEY ?? "";

  // タイムアウト（504等）・一時エラー（429/5xx）・ネットワーク断は自動リトライする
  private async fetchWithRetry(body: string): Promise<Response> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const waits = [2000, 5000]; // リトライ間隔（最大3回試行）
    let lastError = "";
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, { method: "POST", headers, body });
        if (res.ok) return res;
        const respBody = await res.text().catch(() => "");
        // HTML のエラーページ（Cloudflare 等）は本文を捨ててステータスだけ残す
        const detail = respBody.trimStart().startsWith("<") ? "" : ` ${respBody.slice(0, 200)}`;
        lastError = `LLM API エラー: HTTP ${res.status}${detail}`;
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt >= waits.length)
          throw new Error(
            retryable ? `${lastError}（LLM側の一時的な障害の可能性があります。しばらくして再実行してください）` : lastError
          );
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("LLM API エラー")) throw e;
        lastError = `LLM API への接続に失敗しました: ${e instanceof Error ? e.message : String(e)}`;
        if (attempt >= waits.length)
          throw new Error(`${lastError}（しばらくして再実行してください）`);
      }
      await new Promise((r) => setTimeout(r, waits[attempt]));
    }
  }

  private async call(purpose: string, prompt: string, maxTokens: number): Promise<unknown> {
    const res = await this.fetchWithRetry(
      JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
      })
    );
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    await audit({
      action: "LlmRequest", // §25.4: モデル・目的・日時・トークン数を監査（本文は記録しない）
      metadata: {
        provider: "openai-compatible",
        baseUrl: this.baseUrl,
        model: this.model,
        purpose,
        inputTokens: data.usage?.prompt_tokens ?? null,
        outputTokens: data.usage?.completion_tokens ?? null,
      },
    });
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM出力が空です");
    // コードフェンス付きで返すモデルへの保険
    const jsonText = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    return JSON.parse(jsonText);
  }

  async classify(maskedText: string) {
    // エラーは握りつぶさず伝播させる（取込ジョブの error に実因が表示される）
    const result = (await this.call(
      "classify",
      `次の文書が技術者のスキルシート（ENGINEER_SHEET）か、案件募集情報（PROJECT_DESCRIPTION）か、どちらでもない（UNKNOWN）かを判定し、次の形式のJSONのみを出力してください。\n${CLASSIFY_SCHEMA}\n\n---\n${maskedText}`,
      // reasoning 系モデルは思考トークンも max_tokens を消費するため余裕を持たせる
      4096
    )) as { kind?: string };
    return result.kind === "ENGINEER_SHEET" || result.kind === "PROJECT_DESCRIPTION"
      ? result.kind
      : ("UNKNOWN" as const);
  }

  async extract(
    maskedText: string,
    kind: "ENGINEER_SHEET" | "PROJECT_DESCRIPTION"
  ): Promise<ExtractionDraft> {
    const isEngineer = kind === "ENGINEER_SHEET";
    const instruction = isEngineer
      ? `次のスキルシートから構造化データを抽出し、次のスキーマに従うJSONのみを出力してください。\n${ENGINEER_SCHEMA}`
      : `次の案件情報から構造化データを抽出し、次のスキーマに従うJSONのみを出力してください。\n${PROJECT_SCHEMA}`;
    const raw = await this.call(
      `extract:${kind}`,
      `${instruction}\n\n---\n${maskedText}`,
      8192
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
