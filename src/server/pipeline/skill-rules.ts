// 案件抽出の後処理（§9.2）: 「参画後に習得できる」と明記された技術を必須スキルから尚可へ移す。
// LLMは必須欄に書かれた環境技術（「AWSを使って開発」等）を必須と誤判定することがあり、
// プロンプト指示だけでは出力が揺れるため、原文に基づく決定的なルールで補正する

// 「取得技術」ブロックの見出し（この行から次の【…】見出しまでを習得予定の記述とみなす）
const LEARNABLE_BLOCK_HEAD = /(取得技術|習得技術|習得予定)/;
// 行単位の習得可能マーカー（ブロック外でもこの語を含む行は習得予定の記述とみなす）
const LEARNABLE_LINE = /(勉強期間|習得予定|キャッチアップ可|経験がなくて[もで]可|経験がなくて[もで]OK|未経験可)/;

// 原文から「参画後に習得できる技術」への言及部分を集める
export function collectLearnableText(text: string): string {
  const lines = text.split(/\r?\n/);
  const parts: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    const isHeading = /^[\s　]*[【■◆▼○〇*＊<＜]/.test(line) || /^[\s　]*\S+[:：]\s*$/.test(line);
    if (inBlock) {
      // 次のセクション見出し（【…】）でブロック終了
      if (/^[\s　]*【/.test(line) && !LEARNABLE_BLOCK_HEAD.test(line)) inBlock = false;
      else {
        parts.push(line);
        continue;
      }
    }
    if (LEARNABLE_BLOCK_HEAD.test(line) && isHeading) {
      inBlock = true;
      parts.push(line);
      continue;
    }
    if (LEARNABLE_LINE.test(line)) parts.push(line);
  }
  return parts.join("\n");
}

// 必須スキルのうち習得予定と明記された技術を尚可へ移す（重複は尚可側で除去）
export function demoteLearnableSkills(
  text: string,
  requiredSkills: string[],
  preferredSkills: string[]
): { requiredSkills: string[]; preferredSkills: string[] } {
  const learnable = collectLearnableText(text).toLowerCase();
  if (!learnable) return { requiredSkills, preferredSkills };
  const required: string[] = [];
  const demoted: string[] = [];
  for (const s of requiredSkills) {
    const key = s.trim().toLowerCase();
    if (key.length >= 2 && learnable.includes(key)) demoted.push(s);
    else required.push(s);
  }
  if (demoted.length === 0) return { requiredSkills, preferredSkills };
  const preferred = [...preferredSkills];
  for (const s of demoted) {
    if (!preferred.some((p) => p.trim().toLowerCase() === s.trim().toLowerCase())) preferred.push(s);
  }
  return { requiredSkills: required, preferredSkills: preferred };
}
