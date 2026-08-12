// 取込・添付ファイルからのテキスト抽出（§9.2）
// 対応形式: PDF（画像PDFはOCR） / Word(.doc, .docx) / Excel(.xlsx, .xls) /
// 画像（.jpg, .png 等 → OCR） / テキスト系（.txt, .csv 等）

import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { OCR_IMAGE_EXTENSIONS, ocrImage, ocrPdf } from "./ocr";

// 職務経歴書として添付を受け付ける拡張子（Excel / Word / PDF 限定）
export const SKILL_SHEET_EXTENSIONS = [".pdf", ".doc", ".docx", ".xls", ".xlsx"];

const ext = (filename: string) => {
  const m = filename.toLowerCase().match(/\.[^.]+$/);
  return m ? m[0] : "";
};

export function isSkillSheetFile(filename: string): boolean {
  return SKILL_SHEET_EXTENSIONS.includes(ext(filename));
}

// ファイル内容をテキストへ変換する。未対応・破損ファイルは Error を投げる
export async function extractDocumentText(filename: string, content: Buffer): Promise<string> {
  const e = ext(filename);
  if (e === ".pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: content });
    let text: string | undefined;
    try {
      const result = await parser.getText();
      text = result.text?.trim();
    } finally {
      await parser.destroy();
    }
    if (text) return text;
    // テキスト層がないPDF（スキャン・画像PDF）はOCRで文字起こしする
    const ocrText = await ocrPdf(content);
    if (!ocrText) throw new Error("PDF からテキストを抽出できませんでした（OCRでも文字を検出できません）");
    return ocrText;
  }
  if (OCR_IMAGE_EXTENSIONS.includes(e)) {
    const text = await ocrImage(content);
    if (!text)
      throw new Error(
        "画像から文字を検出できませんでした。明るい場所で真上から撮影し直すか、PDF等のファイルで取り込んでください"
      );
    return text;
  }
  if (e === ".docx") {
    const result = await mammoth.extractRawText({ buffer: content });
    const text = result.value?.trim();
    if (!text) throw new Error("Word ファイルからテキストを抽出できませんでした");
    return text;
  }
  if (e === ".doc") {
    // 旧形式 Word（バイナリ .doc）は word-extractor で抽出する
    const { default: WordExtractor } = await import("word-extractor");
    const extractor = new WordExtractor();
    const result = await extractor.extract(content).catch(() => null);
    const text = result?.getBody()?.trim();
    if (!text)
      throw new Error("Word（.doc）からテキストを抽出できませんでした。.docx か PDF に変換してください");
    return text;
  }
  if (e === ".xlsx" || e === ".xls") {
    const wb = XLSX.read(content, { type: "buffer" });
    const parts: string[] = [];
    for (const name of wb.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]).trim();
      if (csv) parts.push(`【シート: ${name}】\n${csv}`);
    }
    const text = parts.join("\n\n").trim();
    if (!text) throw new Error("Excel ファイルからテキストを抽出できませんでした");
    return text;
  }
  // テキスト系はそのまま
  return content.toString("utf-8");
}
