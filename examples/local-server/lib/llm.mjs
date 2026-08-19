// 自前LLMによる構造化抽出（OpenAI互換 chat/completions）。
// 本体パイプラインと同等のプロンプト・出力スキーマを使用する。
// LLM送信禁止・取込時の匿名化は2026-08-19に全面撤廃（本体 §25.2 と同じ）。原文を送信する。

const SYSTEM_PROMPT = `あなたはSES（システムエンジニアリングサービス）業界の文書を正規化する抽出エンジンです。
入力は取込書類の原文です（氏名等の個人情報を含むことがあります）。
氏名は name 項目にのみ出力し、summary 等の自由記述には個人を特定しうる情報（氏名・連絡先・企業実名）を含めてはいけません（他社に公開される匿名要約のため）。
- 指定された JSON スキーマに厳密に従った JSON オブジェクトのみを出力する（説明文・コードフェンス禁止）
- 日付は ISO 8601（YYYY-MM-DD）の文字列で出力する
- 単価は月額の円整数で出力する（例: 70万円 → 700000）
- スキル名は一般的な正式名称に正規化する（例: "JAVA" → "Java"）
- 経験年数は月数に換算する（例: 5年 → 60）
- 判断できない項目は null にする（推測で埋めない）
- summary などの自由記述の文字列は、必ず自然な日本語で書く`;

const ENGINEER_SCHEMA = `{
  "name": string | null,               // エンジニア本人の氏名（氏名欄・宛名等の記載から。敬称・フリガナは除く）。記載がなければ null
  "ageBand": number | null,            // 5歳刻み年代の下限（例: 35）
  "nationality": string | null,        // 国籍（国名）。「外国籍」のみで国名不明なら "外国籍"。記載がなければ null
  "residenceCity": string | null,      // 居住エリア（都道府県から記載）
  "availableFrom": string | null,      // 稼働可能日 YYYY-MM-DD
  "desiredRateYen": number | null,     // 希望月額単価（円整数）
  "maxOnsiteDaysPerWeek": number | null, // 週あたり最大出社日数 0-5
  "skills": [{"category": "LANGUAGE"|"FRAMEWORK"|"DATABASE"|"CLOUD"|"OS"|"TOOL"|"CERTIFICATION", "name": string, "months": number | null}],
  "processes": string[],               // 経験工程（要件定義/基本設計/詳細設計/開発/テスト/運用/保守）
  "roles": string[],                   // 経験役割（PM/PL/SE/PG 等）
  "industries": string[],              // 業種経験（金融/製造/EC 等）
  "summary": string                    // 匿名要約200字以内。PII・企業名を含めない
}`;

const PROJECT_SCHEMA = `{
  "name": string | null,               // 案件名
  "startDate": string | null,          // 開始日 YYYY-MM-DD
  "rateMaxYen": number | null,         // 月額単価上限（円整数）
  "onsiteDaysPerWeek": number | null,  // 週出社日数 0-5
  "locationCity": string | null,       // 勤務地（都道府県から記載）
  "noForeignNational": boolean | null, // 外国籍不可なら true、可なら false、記載なしは null
  "requiredSkills": string[],          // 必須スキル（技術要素のみ、重要な順に最大5個）
  "preferredSkills": string[],         // 尚可スキル
  "summary": string                    // 匿名要約。エンド企業名は抽象カテゴリに置換
}`;

export class LlmClient {
  constructor({ baseUrl, apiKey, model }) {
    this.baseUrl = (baseUrl ?? "").replace(/\/+$/, "");
    this.apiKey = apiKey ?? "";
    this.model = model ?? "";
  }

  // 一時エラー（429/5xx）・ネットワーク断は自動リトライする
  async #chat(prompt) {
    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    });
    const headers = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const waits = [2000, 5000];
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, { method: "POST", headers, body });
        if (res.ok) {
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content ?? "";
          return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
        }
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt >= waits.length)
          throw new Error(`LLM API エラー: HTTP ${res.status}`);
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("LLM API")) throw e;
        if (attempt >= waits.length)
          throw new Error(`LLM API への接続に失敗しました: ${e instanceof Error ? e.message : e}`);
      }
      await new Promise((r) => setTimeout(r, waits[attempt]));
    }
  }

  // kind: "PROJECT_DESCRIPTION" | "ENGINEER_SHEET"（受入フォルダで確定するため種別判定は行わない）
  async extract(maskedText, kind) {
    const schema = kind === "ENGINEER_SHEET" ? ENGINEER_SCHEMA : PROJECT_SCHEMA;
    const label = kind === "ENGINEER_SHEET" ? "人材スキルシート" : "案件票";
    const result = await this.#chat(
      `次の${label}のテキストから、以下のJSONスキーマに従って情報を抽出してください。\n\nスキーマ:\n${schema}\n\nテキスト:\n${maskedText}`
    );
    if (typeof result !== "object" || result === null || typeof result.summary !== "string")
      throw new Error("LLMの出力がスキーマに従っていません（summary がありません）");
    return result;
  }
}
