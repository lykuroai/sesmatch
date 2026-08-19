// 連絡先検出（§21）
// 取込時のPII匿名化・LLM送信禁止は2026-08-19に全面撤廃した（§25.2。取込テキストは
// 原文のままLLMへ送信し、氏名はLLMの抽出対象。公開画面の匿名性・段階開示は §10 で維持）。
// 本モジュールに残るのは、相互承認前のメッセージから連絡先を検出する機能のみ。

const CONTACT_PATTERNS: { kind: "EMAIL" | "PHONE" | "URL" | "SNS"; re: RegExp }[] = [
  { kind: "EMAIL", re: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
  { kind: "URL", re: /https?:\/\/[^\s　]+/g },
  { kind: "PHONE", re: /0\d{1,4}[-‐−ー]?\d{1,4}[-‐−ー]?\d{3,4}/g },
  { kind: "SNS", re: /@[A-Za-z0-9_]{3,}/g },
];

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
  for (const target of [text, normalized]) {
    for (const { kind, re } of CONTACT_PATTERNS) {
      if (new RegExp(re.source, re.flags).test(target)) findings.add(kind);
    }
  }
  return [...findings];
}
