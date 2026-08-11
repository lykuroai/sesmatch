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
  termProposalSchema,
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
- 例外: スキルの経験月数（months）に限り、明記がなければ経歴欄のプロジェクト期間から推定してよい（推定した場合は monthsEstimated=true を付ける）
- summary などの自由記述の文字列は、必ず自然な日本語で書く（英語・中国語で出力しない）`;

const CLASSIFY_SCHEMA = `{"kind": "ENGINEER_SHEET" | "PROJECT_DESCRIPTION" | "UNKNOWN"}`;

const ENGINEER_SCHEMA = `{
  "kind": "ENGINEER_SHEET",
  "affiliationType": "EMPLOYEE" | "AFFILIATED" | "FREELANCER" | "SUBTIER1" | null,
                                       // 所属区分: 自社社員(正社員・雇用) / 自社所属(業務委託) / 個人事業主(フリーランス・弊社直個人) / 一社下(協力会社所属)。判断できなければ null
  "ageBand": number | null,            // 5歳刻み年代の下限（例: 35）
  "nationality": string | null,        // 国籍（国名。例: 韓国、中国、ベトナム）。「外国籍」のみで国名不明なら "外国籍"。記載がなければ null（=日本国籍とみなす）
  "residenceCity": string | null,      // 居住エリア。都道府県から記載（例: 神奈川県川崎市）。市区町村から都道府県が特定できる場合は必ず都道府県を付ける
  "availableFrom": string | null,      // 稼働可能日 YYYY-MM-DD
  "desiredRateYen": number | null,     // 希望月額単価（円整数）
  "maxOnsiteDaysPerWeek": number | null, // 週あたり最大出社日数 0-5
  "skills": [{"category": "LANGUAGE"|"FRAMEWORK"|"DATABASE"|"CLOUD"|"OS"|"TOOL"|"CERTIFICATION", "name": string, "months": number | null, "monthsEstimated": boolean}],
                                       // months: スキル一覧に経験年数・月数の明記があればその値（monthsEstimated=false）。
                                       // 明記がない場合は、【そのスキルが使用技術として登場するプロジェクトの期間だけ】を合算して推定し monthsEstimated=true とする。
                                       // 登場しないプロジェクトの期間は含めない。業界経験・経歴全体の年数（例:「エンジニア歴15年」）をスキルの月数として使ってはいけない。
                                       // 使用したプロジェクトが異なれば月数もスキルごとに異なるのが自然（全スキルが同じ月数になるのは経歴全体を使った誤り）。
                                       // 期間が重複するプロジェクトは重複期間を二重に数えない。経歴からも判断できない場合のみ months=null
  "processes": string[],               // 経験工程（要件定義/基本設計/詳細設計/開発/テスト/運用/保守）
  "roles": string[],                   // 経験役割（PM/PMO/PL/リーダー/テックリード/SE/PG 等。経歴から判断）
  "industries": string[],              // 業種経験（金融/製造/EC/通信/公共/医療 等。経歴のプロジェクトから判断）
  "summary": string                    // 匿名要約200字以内。自然な日本語で書く。PII・企業名を含めない
}`;

const PROJECT_SCHEMA = `{
  "kind": "PROJECT_DESCRIPTION",
  "name": string | null,               // 案件名
  "startDate": string | null,          // 開始日 YYYY-MM-DD
  "rateMaxYen": number | null,         // 月額単価上限（円整数）
  "onsiteDaysPerWeek": number | null,  // 週出社日数 0-5
  "locationCity": string | null,       // 勤務地。都道府県から記載（例: 東京都中野区）。市区町村・地名から都道府県が特定できる場合は必ず都道府県を付ける。記載がなければ null
  "noForeignNational": boolean | null, // 外国籍の受入条件。「外国籍不可」「外国人NG」「日本国籍の方のみ」等の記載があれば true、
                                       // 「外国籍可」「国籍不問」等なら false、記載がなければ null
  "requiredSkills": string[],          // 必須スキル。技術要素（言語・フレームワーク・DB・クラウド・製品・技術領域）のみ、重要な順に最大5個。
                                       // マッチングでスキル名の完全一致・全充足が求められるため、真に必須の技術だけに絞る。
                                       // 「資料作成」「顧客折衝」「関係者調整」「会議ファシリテーション」等の職務要件・ソフトスキルは含めない（summary に書く）
  "preferredSkills": string[],         // 尚可スキル。「尚可」「歓迎」とされた技術要素と、必須から溢れた技術要素
  "summary": string                    // 匿名要約。自然な日本語で書く。エンド企業名は「大手金融機関」等の抽象カテゴリに置換
}`;

export class OpenAiCompatGateway implements LlmGateway {
  private baseUrl = (process.env.LLM_BASE_URL ?? "").replace(/\/+$/, "");
  private model = process.env.LLM_MODEL ?? "";
  private apiKey = process.env.LLM_API_KEY ?? "";
  // 思考(reasoning)モデルの思考出力を抑制して高速化する（実測で3.4秒→1.5秒・トークン77%減）。
  // 非対応モデルでエラーになる場合は LLM_REASONING_EFFORT=default で送信を止められる
  private reasoningEffort = process.env.LLM_REASONING_EFFORT ?? "none";

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
        ...(this.reasoningEffort !== "default" ? { reasoning_effort: this.reasoningEffort } : {}),
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

  // 用語辞書の候補提案（Phase 2 名寄せ）: 新語の正規形を提案する。
  // 失敗しても取込は成立させるため、呼び出し側でエラーを握りつぶす前提の補助機能
  async proposeCanonicalTerms(terms: string[], canonicals: string[]) {
    const prompt = `SES業界のスキル・工程・業種の用語について、新しく現れた各用語の「正規形」を提案し、次の形式のJSONのみを出力してください。
{"proposals": [{"term": "入力した用語", "canonical": "正規形"}]}

ルール:
- 既存の正規形リストに同義の語があれば、その語を正規形として使う
- 無ければ一般的な正式名称・代表表記を正規形とする（例: "保険業務" → "保険", "RoR" → "Rails", "JS" → "JavaScript"）
- 同義と確信できない場合は正規形に用語そのものを返す（無理にまとめない。JavaとJavaScriptのような別技術を同一視しない）

既存の正規形リスト: ${JSON.stringify(canonicals)}
新しい用語: ${JSON.stringify(terms)}`;
    const raw = await this.call("propose-terms", prompt, 4096);
    const parsed = termProposalSchema.safeParse(raw);
    return parsed.success ? parsed.data.proposals : [];
  }
}
