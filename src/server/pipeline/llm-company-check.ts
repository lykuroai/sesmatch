// 企業重複チェック（LLM）: 新規申込の企業名・所在地を既存企業リストと照合し、
// 表記ゆれ（法人格の略記・カナ/英字・旧字・前後株）や所在地の一致を考慮して同一企業かを判定する。
// 注意: 本モジュールは登録企業の重複判定のみを目的として企業名・所在地を LLM に送信する
// （§25 の「企業実名を送らない」原則の明示的な例外。人材・案件データは一切送らない）。
// LLM 未設定・障害時は判定をスキップして申込を通す（可用性優先。決定的チェックは別途実施）

import { audit } from "@/server/audit";

export type DuplicateCheckResult = {
  duplicate: boolean;
  matchedName: string | null;
  reason: string;
};

const SYSTEM_PROMPT = `あなたは企業データベースの名寄せ（同一企業判定）を行う判定エンジンです。
新規申込企業と既存企業リストを比較し、同一企業と考えられる既存企業があるかを判定します。
- 法人格の表記ゆれは同一視する（株式会社/（株）/㈱、前株・後株、有限会社/（有） 等）
- ひらがな・カタカナ・英字・大文字小文字の表記ゆれ、スペースの有無も同一視する
- 所在地が同一・近接で名称が類似していれば同一の可能性が高い
- 名称が類似していても所在地が明確に異なる場合は別企業の可能性を考慮する
- 判断に迷う場合は duplicate=false とする（誤ブロックを避ける）
- 指定された JSON のみを出力する`;

export async function checkCompanyDuplicate(
  candidate: { name: string; address?: string },
  existing: { name: string; address?: string | null }[]
): Promise<DuplicateCheckResult | null> {
  const baseUrl = (process.env.LLM_BASE_URL ?? "").replace(/\/+$/, "");
  const apiKey = process.env.LLM_API_KEY ?? "";
  const model = process.env.LLM_MODEL ?? "";
  if (!baseUrl || existing.length === 0) return null; // LLM未設定・比較対象なしはスキップ

  const list = existing
    .slice(0, 300) // プロンプト肥大防止
    .map((c, i) => `${i + 1}. ${c.name}${c.address ? `（所在地: ${c.address}）` : ""}`)
    .join("\n");
  const prompt = `新規申込企業:
名称: ${candidate.name}
所在地: ${candidate.address ?? "不明"}

既存企業リスト:
${list}

新規申込企業と同一と考えられる既存企業があるか判定し、次のJSONのみを出力してください。
{"duplicate": boolean, "matchedName": string | null, "reason": string}
matchedName には同一と判断した既存企業の名称（リストの表記のまま）を入れ、同一企業がなければ null にしてください。reason は日本語で簡潔に。`;

  try {
    // 一時エラー（429/5xx・タイムアウト・接続断）はリトライする（LLM側の瞬断対策）
    let res: Response | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 2000));
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(45_000), // LLM遅延時は判定をスキップ（申込を止めない）
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          temperature: 0,
          response_format: { type: "json_object" },
          ...(process.env.LLM_REASONING_EFFORT !== "default"
            ? { reasoning_effort: process.env.LLM_REASONING_EFFORT ?? "none" }
            : {}),
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
        }),
        });
        if (res.ok || (res.status !== 429 && res.status < 500)) break;
      } catch (e) {
        lastErr = e;
        res = null;
      }
    }
    if (!res || !res.ok)
      throw lastErr instanceof Error ? lastErr : new Error(`HTTP ${res?.status}`);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    await audit({
      action: "LlmRequest",
      metadata: {
        provider: "openai-compatible",
        model,
        purpose: "company-duplicate-check",
        inputTokens: data.usage?.prompt_tokens ?? null,
        outputTokens: data.usage?.completion_tokens ?? null,
      },
    });
    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, ""));
    if (typeof parsed.duplicate !== "boolean") return null;
    return {
      duplicate: parsed.duplicate,
      matchedName: typeof parsed.matchedName === "string" ? parsed.matchedName : null,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch (e) {
    // LLM 障害時は判定スキップ（申込を止めない）。運営が追跡できるよう監査ログに記録
    const reason = e instanceof Error ? e.message : String(e);
    console.error("[company-duplicate-check] skipped:", reason);
    await audit({
      action: "CompanyDuplicateCheckSkipped",
      metadata: { reason: reason.slice(0, 120) },
    }).catch(() => {});
    return null;
  }
}
