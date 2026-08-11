// PII検出・匿名化（§11, §25.3）
// `PII検出 → トークン置換 → 匿名化検査 → LLM` の前段を担う。
// MVP は正規表現ベース。本番では NER 等による検出器へ差し替える。

export type PiiToken = {
  token: string;
  originalValue: string;
  kind: "EMAIL" | "PHONE" | "URL" | "SNS" | "BIRTHDATE" | "ADDRESS" | "NAME" | "COMPANY";
};

export type MaskResult = {
  masked: string;
  tokens: PiiToken[];
};

const PATTERNS: { kind: PiiToken["kind"]; re: RegExp }[] = [
  { kind: "EMAIL", re: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
  { kind: "URL", re: /https?:\/\/[^\s　]+/g },
  { kind: "PHONE", re: /0\d{1,4}[-‐−ー]?\d{1,4}[-‐−ー]?\d{3,4}/g },
  { kind: "SNS", re: /@[A-Za-z0-9_]{3,}/g },
  { kind: "BIRTHDATE", re: /(19|20)\d{2}年\s?\d{1,2}月\s?\d{1,2}日生/g },
  // 住所番地（〇丁目〇-〇 等）。市区町村までは保持する（§13）。
  { kind: "ADDRESS", re: /\d+丁目\d+[-−]\d+(?:[-−]\d+)?/g },
  // 企業名（§11.1: 所属企業名・顧客企業名はマスク対象）
  {
    kind: "COMPANY",
    re: /(?:株式会社|合同会社|有限会社)[一-龥ァ-ヶーa-zA-Z0-9]{1,20}|[一-龥ァ-ヶーa-zA-Z0-9]{1,20}(?:株式会社|合同会社|有限会社)/g,
  },
  // 宛名（行頭の「〇〇様」）。「仕様書」「お客様」等の誤検知を避けるため、
  // 行頭かつ「様」の直後が文末・空白・句読点の場合のみ対象とする
  { kind: "NAME", re: /^[一-龥]{1,4}[ 　]*様(?=$|[\s、。])/gm },
];

// 氏名パターン: ラベル付き記載を対象とする。区切りはコロンだけでなく
// カンマ（XLSX→CSV変換で頻出）・タブ・空白・全角空白も許容する。
// 値は氏名らしい文字（漢字・カナ・ラテン）1〜2語に限定し、prose の過剰マスクを抑える。
const NAME_LABEL_RE =
  /(氏名|名前|フリガナ|ふりがな)\s*[:：,，\t 　]+\s*([一-龥ぁ-んァ-ヶーA-Za-z]{1,12}(?:[ 　][一-龥ぁ-んァ-ヶーA-Za-z]{1,12})?)/g;

export function maskPii(text: string): MaskResult {
  const tokens: PiiToken[] = [];
  let masked = text;
  const counters: Record<string, number> = {};

  const replace = (value: string, kind: PiiToken["kind"]): string => {
    const existing = tokens.find((t) => t.originalValue === value && t.kind === kind);
    if (existing) return existing.token;
    counters[kind] = (counters[kind] ?? 0) + 1;
    const token = `[PII_${kind}_${counters[kind]}]`;
    tokens.push({ token, originalValue: value, kind });
    return token;
  };

  masked = masked.replace(NAME_LABEL_RE, (_m, label, name) => `${label}: ${replace(name, "NAME")}`);

  for (const { kind, re } of PATTERNS) {
    masked = masked.replace(re, (m) => replace(m, kind));
  }

  return { masked, tokens };
}

// 連絡先検出（§21）: 相互承認前のメッセージから連絡先・回避表現を検出する。
// 全角文字・空白挿入による回避（例: ｔａｒｏ＠ex．com、0 9 0 - 1234）を正規化してから照合する。
export function detectContactInfo(text: string): string[] {
  const normalized = text
    // 全角英数・記号を半角へ
    .replace(/[Ａ-Ｚａ-ｚ０-９＠．＿－]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    )
    .replace(/[｡。]/g, ".")
    // 数字・記号間の空白挿入回避を除去
    .replace(/(?<=[\d@.\w-])[\s　]+(?=[\d@.\w-])/g, "");

  const findings = new Set<string>();
  const NON_CONTACT_KINDS = ["BIRTHDATE", "ADDRESS", "COMPANY", "NAME"]; // メッセージ検査対象は連絡先系のみ
  for (const target of [text, normalized]) {
    for (const { kind, re } of PATTERNS) {
      if (NON_CONTACT_KINDS.includes(kind)) continue;
      if (new RegExp(re.source, re.flags).test(target)) findings.add(kind);
    }
  }
  return [...findings];
}

// 匿名化検査（§25.3）: LLM 送信前に残存 PII がないか検査する。
// findings には種別のみを入れ、残存 PII の実値は含めない（ログ・DBへの平文保存を防ぐ）。
export function verifyMasked(masked: string): { ok: boolean; findings: string[] } {
  const findings: string[] = [];
  for (const { kind, re } of PATTERNS) {
    if (new RegExp(re.source, re.flags).test(masked)) findings.push(kind);
  }
  // ラベル付き氏名（「氏名,山田太郎」等）の残存も検査する（マスク漏れの検出漏れ対策）
  if (new RegExp(NAME_LABEL_RE.source).test(masked)) findings.push("NAME");
  return { ok: findings.length === 0, findings };
}
