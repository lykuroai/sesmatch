// 最小限の CSV パーサ（RFC 4180 サブセット: 引用符・引用符内のカンマと改行・"" エスケープ対応）
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, ""); // Excel が付ける BOM を除去
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // 空行は除外
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

// 企業リスト取込用の列マッピング。ヘッダ行があれば列名で判定し、
// なければ列数で判定する（3列: 企業名, 担当者名, メールアドレス ／ 5列: 従来形式）。
// 種別・法人番号のない不完全なリストも取り込めるようにする（後から企業修正で補完）。
export type CompanyCsvRow = {
  companyName: string;
  companyType: "CORPORATION" | "SOLE_PROPRIETOR";
  corporateNumber?: string;
  ownerName: string;
  email: string;
};

export function csvToCompanyRows(lines: string[][]): CompanyCsvRow[] {
  if (lines.length === 0) return [];
  const first = lines[0];
  const hasHeader = first.some((col) => /企業名|会社名|company/i.test(col));
  const body = hasHeader ? lines.slice(1) : lines;
  let idx: { name: number; type: number; corp: number; owner: number; email: number };
  if (hasHeader) {
    const find = (re: RegExp) => first.findIndex((c) => re.test(c));
    idx = {
      name: find(/企業名|会社名/),
      type: find(/種別/),
      corp: find(/法人番号/),
      owner: find(/オーナー|担当/),
      email: find(/メール|mail/i),
    };
  } else if (first.length <= 3) {
    idx = { name: 0, type: -1, corp: -1, owner: 1, email: 2 };
  } else {
    idx = { name: 0, type: 1, corp: 2, owner: 3, email: 4 };
  }
  const pick = (cols: string[], i: number) => (i >= 0 ? (cols[i] ?? "").trim() : "");
  return body.map((cols) => ({
    companyName: pick(cols, idx.name),
    companyType: /個人|SOLE/i.test(pick(cols, idx.type))
      ? ("SOLE_PROPRIETOR" as const)
      : ("CORPORATION" as const),
    corporateNumber: pick(cols, idx.corp).replace(/\D/g, "") || undefined,
    ownerName: pick(cols, idx.owner),
    email: pick(cols, idx.email),
  }));
}
