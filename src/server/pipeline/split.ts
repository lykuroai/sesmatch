// 複数案件が1つの貼り付け・ファイルに含まれるケースの分割（§9）。
// 行頭を正規化（NFKC・装飾記号の除去）して「案件名」「概要」「スキル」等のラベルを認識し、
// 「タイトル系ラベルの後に要素系ラベルが続く」という案件ブロックの構造で境界を判定する。
// 括弧の種類（【】/[]/〔〕）や OCR の誤認識（「[ 案件名】」等）、「■案件名:」のような書式にも対応する。
// 本文中に「案件名」という語が現れるだけの行（例: 提案手順の「①案件名 ②経歴書」）は、
// 直後に要素ラベルが続かないため境界にならない。
// LLMを使わないローカル処理のため、匿名化前のテキストに適用してよい。

// 分割の上限（超えた分は最後のセグメントにまとめて含める）
export const MAX_SPLIT_ITEMS = 10;

// タイトル系ラベル: この行を案件の開始境界の候補とする
const TITLE_LABELS = ["案件タイトル", "プロジェクト名", "募集案件", "案件名", "PJ名", "案件", "件名"];

// 要素系ラベル: タイトル候補の直後に現れることで「案件ブロックの形」を裏付ける
const FIELD_LABELS = [
  "概要", "業務内容", "作業内容", "案件内容", "開発内容",
  "スキル", "必須スキル", "求めるスキル", "歓迎スキル",
  "場所", "勤務地", "最寄駅", "エリア",
  "期間", "時期", "開始時期", "稼働",
  "単価", "予算", "金額", "報酬",
  "人数", "募集人数", "商流", "契約形態", "外国籍",
  "精算", "面談", "備考", "勤務時間", "就業時間", "リモート", "在宅",
];

// 長いラベルから先に照合する（「案件名」を「案件」より優先）
const ALL_LABELS: { label: string; kind: "title" | "field" }[] = [
  ...TITLE_LABELS.map((label) => ({ label, kind: "title" as const })),
  ...FIELD_LABELS.map((label) => ({ label, kind: "field" as const })),
].sort((a, b) => b.label.length - a.label.length);

// ラベルの直後に許す区切り文字（正規化後）。これが続かない場合は本文の一部とみなす
const LABEL_DELIMITERS = "】]〕）):：、。｜|・";

// タイトル候補からこの行数以内に要素ラベルが無ければ境界として採用しない
const FIELD_LOOKAHEAD_LINES = 20;

// 行頭の装飾（括弧・記号・番号）を取り除き、素のラベル比較用文字列を返す
function normalizeLineHead(line: string): string {
  return line
    .normalize("NFKC") // 全角英数・丸数字・全角括弧の一部を半角へ
    .trim()
    .replace(/^[【\[〔（(●■◆◇▼△★☆※＊*・〇○◎>＞\d\s.\-ー―－]+/, "");
}

// 行がラベル行ならその種別を返す（タイトル系 / 要素系）
export function labelKindOfLine(line: string): "title" | "field" | null {
  const s = normalizeLineHead(line);
  if (!s) return null;
  for (const { label, kind } of ALL_LABELS) {
    if (!s.startsWith(label)) continue;
    const rest = s.slice(label.length);
    if (rest === "" || LABEL_DELIMITERS.includes(rest[0])) return kind;
  }
  return null;
}

export function splitProjectItems(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const labeled = lines
    .map((line, idx) => ({ idx, kind: labelKindOfLine(line) }))
    .filter((l): l is { idx: number; kind: "title" | "field" } => l.kind !== null);
  const titleCandidates = labeled.filter((l) => l.kind === "title");
  const fields = labeled.filter((l) => l.kind === "field");

  // タイトル候補のうち、次のタイトル候補（または一定行数）までに要素ラベルが続くものだけを境界にする
  const boundaries = titleCandidates
    .filter((t, i) => {
      const next = titleCandidates[i + 1]?.idx ?? Infinity;
      const windowEnd = Math.min(next, t.idx + 1 + FIELD_LOOKAHEAD_LINES);
      return fields.some((f) => f.idx > t.idx && f.idx < windowEnd);
    })
    .map((t) => t.idx);

  // フォールバック: タイトル見出しの無い文書でも、先頭の要素ラベルと同じラベルが
  // 繰り返されていれば、その繰り返しを案件の境界とみなす
  let heads = boundaries;
  if (heads.length < 2 && fields.length > 0) {
    const firstLabelKindIdx = fields[0].idx;
    const firstLabel = lines[firstLabelKindIdx];
    const firstLabelName = ALL_LABELS.find(
      (l) => l.kind === "field" && normalizeLineHead(firstLabel).startsWith(l.label)
    )?.label;
    if (firstLabelName) {
      const repeats = fields
        .filter((f) => {
          const s = normalizeLineHead(lines[f.idx]);
          return s.startsWith(firstLabelName);
        })
        .map((f) => f.idx);
      if (repeats.length >= 2) heads = repeats;
    }
  }

  if (heads.length < 2) return [text];

  const capped = heads.slice(0, MAX_SPLIT_ITEMS);
  const segments: string[] = [];
  for (let i = 0; i < capped.length; i++) {
    const start = i === 0 ? 0 : capped[i]; // 冒頭の挨拶文などは1件目に含める
    const end = i + 1 < capped.length ? capped[i + 1] : lines.length;
    const seg = lines.slice(start, end).join("\n").trim();
    if (seg) segments.push(seg);
  }
  return segments.length >= 2 ? segments : [text];
}

// 分割時の表示ファイル名（拡張子の前に「（i/N）」を挿入）
export function splitFilename(filename: string, index: number, totalCount: number): string {
  const m = filename.match(/^(.*?)(\.[^.]+)?$/);
  const base = m?.[1] ?? filename;
  const ext = m?.[2] ?? "";
  return `${base}（${index}/${totalCount}）${ext}`;
}

// ---- 人材書類の複数件分割（PRO版仕様書 §4.2）----
// スキルシート1枚に複数名が含まれる場合、LLM が「人数」と「2人目以降の記載が始まる行（原文のまま）」を
// 判定し（llm.ts splitEngineerSheets）、ここでその行を境界にローカルで分割する。
// LLM に全文を書き直させない（原文の欠落・改変を防ぐ）ため、境界行の照合だけを行う。
// 境界行は行頭の装飾・空白・全半角のゆれを吸収して照合し、1人目の冒頭（表紙・挨拶文）は1件目に含める

function normalizeBoundary(line: string): string {
  return line.normalize("NFKC").replace(/\s+/g, "").replace(/^[【\[〔（(●■◆◇▼△★☆※＊*・〇○◎>＞\-ー―－]+/, "");
}

// count: LLM が判定した人数。boundaries が人数分あれば先頭の境界は1人目の開始（＝文書先頭に含める）とみなし、
// 人数より少なければ「2人目以降の開始行だけが返された」とみなして全てを切れ目にする
export function splitEngineerSegments(text: string, boundaries: string[], count?: number): string[] {
  const lines = text.split(/\r?\n/);
  const normalizedLines = lines.map(normalizeBoundary);
  const indices: number[] = [];
  let from = 0;
  for (const b of boundaries) {
    const nb = normalizeBoundary(b);
    if (!nb) continue;
    // 前の境界より後ろで、正規化後に一致（または前方一致）する最初の行を探す
    let found = -1;
    for (let i = from; i < lines.length; i++) {
      const nl = normalizedLines[i];
      if (nl && (nl === nb || nl.startsWith(nb) || nb.startsWith(nl) && nl.length >= 4)) {
        found = i;
        break;
      }
    }
    if (found < 0) continue;
    indices.push(found);
    from = found + 1;
  }
  // 1人目の開始は常に文書の先頭（最初に見つかった境界が先頭でなくても、表紙・挨拶文はその人に含める）
  const includesFirstPerson = count == null || boundaries.length >= count;
  const cuts = (includesFirstPerson ? indices.slice(1) : indices).filter((i) => i > 0);
  const heads = [0, ...cuts];
  if (heads.length < 2) return [text];
  const capped = heads.slice(0, MAX_SPLIT_ITEMS);
  const segments: string[] = [];
  for (let i = 0; i < capped.length; i++) {
    const end = i + 1 < capped.length ? capped[i + 1] : lines.length;
    const seg = lines.slice(capped[i], end).join("\n").trim();
    if (seg) segments.push(seg);
  }
  return segments.length >= 2 ? segments : [text];
}
