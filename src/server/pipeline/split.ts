// 複数案件が1つの貼り付け・ファイルに含まれるケースの分割（§9）。
// 紹介メールで一般的な「【案件名】/【案件】」見出しを区切りとして案件ごとのテキストに分ける。
// LLMを使わないローカル処理のため、匿名化前のテキストに適用してよい。
// 見出しが1つ以下ならそのまま1件として扱う

// 分割の上限（超えた分は最後のセグメントにまとめて含める）
export const MAX_SPLIT_ITEMS = 10;

// 「【案件名】」「【案件】」のみに一致（【案件概要】等には一致しない）。
// OCR経由のテキストは全角括弧「【】」が半角「[ ]」等に化けることがあるため、
// 括弧の表記ゆれ（[ ］ 〔 〕）と括弧内側の空白を許容する
const ITEM_MARKER = /[【\[［〔]\s*案件名?\s*[】\]］〕]/g;

export function splitProjectItems(text: string): string[] {
  const indices = [...text.matchAll(ITEM_MARKER)].map((m) => m.index ?? 0);
  if (indices.length < 2) return [text];
  const heads = indices.slice(0, MAX_SPLIT_ITEMS);
  const segments: string[] = [];
  for (let i = 0; i < heads.length; i++) {
    const start = i === 0 ? 0 : heads[i]; // 冒頭の挨拶文などは1件目に含める
    const end = i + 1 < heads.length ? heads[i + 1] : text.length;
    const seg = text.slice(start, end).trim();
    if (seg) segments.push(seg);
  }
  return segments;
}

// 分割時の表示ファイル名（拡張子の前に「（i/N）」を挿入）
export function splitFilename(filename: string, index: number, totalCount: number): string {
  const m = filename.match(/^(.*?)(\.[^.]+)?$/);
  const base = m?.[1] ?? filename;
  const ext = m?.[2] ?? "";
  return `${base}（${index}/${totalCount}）${ext}`;
}
