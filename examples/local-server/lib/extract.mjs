// ファイルからのテキスト抽出（OCRなし版）。
// 対応: テキスト系 / Word(.docx) / Excel(.xlsx, .xls) / テキスト層のあるPDF。
// スキャン・画像PDF・画像ファイルはローカル解析非対応（親サーバへ直接送信すれば親側でOCRされる）
import path from "path";

export const SUPPORTED_EXTENSIONS = [".txt", ".csv", ".md", ".docx", ".xlsx", ".xls", ".pdf"];

export async function extractText(filename, buffer) {
  const e = path.extname(filename).toLowerCase();
  if ([".txt", ".csv", ".md"].includes(e)) return buffer.toString("utf-8");

  if (e === ".docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (e === ".xlsx" || e === ".xls") {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buffer, { type: "buffer" });
    return wb.SheetNames.map((name) => XLSX.utils.sheet_to_csv(wb.Sheets[name])).join("\n\n");
  }

  if (e === ".pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    let text = "";
    try {
      const result = await parser.getText();
      text = (result.text ?? "").trim();
    } finally {
      await parser.destroy();
    }
    if (text.length < 30)
      throw new Error(
        "テキスト層のないPDF（スキャン・画像PDF）はローカル解析に対応していません。親サーバの取込パネルから直接取り込んでください"
      );
    return text;
  }

  throw new Error(`未対応のファイル形式です（対応: ${SUPPORTED_EXTENSIONS.join(" ")}）`);
}
