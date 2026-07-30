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
