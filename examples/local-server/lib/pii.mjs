// PII検出・匿名化（本体 src/server/pipeline/pii.ts と同等の正規表現ロジック）。
// 自前LLM（社外サービスの場合あり）へ送る前に必ずこの匿名化を通す。

const PATTERNS = [
  { kind: "EMAIL", re: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
  { kind: "URL", re: /https?:\/\/[^\s　]+/g },
  { kind: "PHONE", re: /0\d{1,4}[-‐−ー]?\d{1,4}[-‐−ー]?\d{3,4}/g },
  { kind: "SNS", re: /@[A-Za-z0-9_]{3,}/g },
  { kind: "BIRTHDATE", re: /(19|20)\d{2}年\s?\d{1,2}月\s?\d{1,2}日生/g },
  // 住所番地（〇丁目〇-〇 等）。市区町村までは保持する
  { kind: "ADDRESS", re: /\d+丁目\d+[-−]\d+(?:[-−]\d+)?/g },
  // 企業名（所属企業名・顧客企業名）
  {
    kind: "COMPANY",
    re: /(?:株式会社|合同会社|有限会社)[一-龥ァ-ヶーa-zA-Z0-9]{1,20}|[一-龥ァ-ヶーa-zA-Z0-9]{1,20}(?:株式会社|合同会社|有限会社)/g,
  },
  // 宛名（行頭の「〇〇様」）
  { kind: "NAME", re: /^[一-龥]{1,4}[ 　]*様(?=$|[\s、。])/gm },
];

// ラベル付き氏名（「氏名: 山田太郎」「氏名,山田太郎」等）
// ラベルは「氏　名」「名 前」のような文字間空白の書式も対象（履歴書で頻出）
const NAME_LABEL_RE =
  /(氏[ 　]{0,2}名|名[ 　]{0,2}前|フリガナ|ふりがな)\s*[:：,，\t 　]+\s*([一-龥ぁ-んァ-ヶーA-Za-z]{1,12}(?:[ 　][一-龥ぁ-んァ-ヶーA-Za-z]{1,12})?)/g;

// 取込書類から検出した氏名候補を返す（本体 pii.ts の suggestPersonName と同等）。
// NAME トークンから検出順（トークン番号順）で漢字を含む値を優先して選ぶ
// （フリガナ欄のカナのみの値や宛名より、氏名欄の記載を優先）。宛名の「様」は除去する。
export function suggestPersonName(tokens) {
  const names = tokens
    .filter((t) => t.kind === "NAME")
    .sort(
      (a, b) =>
        (parseInt(a.token.match(/_(\d+)\]$/)?.[1] ?? "0") || 0) -
        (parseInt(b.token.match(/_(\d+)\]$/)?.[1] ?? "0") || 0)
    )
    .map((t) => t.originalValue.replace(/[ 　]*様$/, "").trim())
    .filter(Boolean);
  if (names.length === 0) return null;
  return names.find((n) => /[一-龥]/.test(n)) ?? names[0];
}

export function maskPii(text) {
  const tokens = [];
  const counters = {};
  const replace = (value, kind) => {
    const existing = tokens.find((t) => t.originalValue === value && t.kind === kind);
    if (existing) return existing.token;
    counters[kind] = (counters[kind] ?? 0) + 1;
    const token = `[PII_${kind}_${counters[kind]}]`;
    tokens.push({ token, originalValue: value, kind });
    return token;
  };

  let masked = text.replace(NAME_LABEL_RE, (_m, label, name) => `${label}: ${replace(name, "NAME")}`);
  for (const { kind, re } of PATTERNS) {
    masked = masked.replace(re, (m) => replace(m, kind));
  }
  return { masked, tokens };
}

// 匿名化検査: LLM送信前に残存PIIがないか確認する（残存があれば送信しない）
export function verifyMasked(masked) {
  const findings = [];
  for (const { kind, re } of PATTERNS) {
    if (new RegExp(re.source, re.flags).test(masked)) findings.push(kind);
  }
  if (new RegExp(NAME_LABEL_RE.source).test(masked)) findings.push("NAME");
  return { ok: findings.length === 0, findings };
}
