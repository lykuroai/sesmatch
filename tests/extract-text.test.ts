import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  countCjkChars,
  extractDocumentText,
  MIN_CJK_FOR_TEXT_LAYER,
  stripPdfPageMarkers,
} from "../src/server/pipeline/extract-text";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mergeImagesToPdf } from "../src/server/pipeline/images-to-pdf";

// OCRは外部コマンド（tesseract）依存のためモックし、PDF/画像のルーティング判定を検証する
vi.mock("../src/server/pipeline/ocr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/server/pipeline/ocr")>();
  return {
    ...actual,
    ocrImage: vi.fn(async () => "画像OCR結果"),
    ocrPdf: vi.fn(async () => "PDF OCR結果"),
  };
});

describe("stripPdfPageMarkers", () => {
  it("pdf-parse のページ区切りだけのテキストは空とみなす", () => {
    expect(stripPdfPageMarkers("\n\n-- 1 of 2 --\n\n\n\n-- 2 of 2 --\n\n")).toBe("");
  });

  it("本文があれば残る", () => {
    expect(stripPdfPageMarkers("-- 1 of 1 --\n案件票")).toBe("案件票");
  });
});

describe("countCjkChars", () => {
  it("ひらがな・カタカナ・漢字を数え、英数字・記号は数えない", () => {
    expect(countCjkChars("Subject: AAS 20260731 ①②※◆")).toBe(0);
    expect(countCjkChars("急募の開発案件テスト")).toBe(10);
  });

  it("しきい値は日本語の案件票なら容易に超える", () => {
    const body = "現在募集している開発支援案件のご紹介です。基本設計から結合試験まで。東京都内・週五日稼働。";
    expect(countCjkChars(body)).toBeGreaterThanOrEqual(MIN_CJK_FOR_TEXT_LAYER);
  });
});

describe("extractDocumentText のOCRルーティング", () => {
  beforeEach(() => vi.clearAllMocks());

  it("テキスト層のないPDF（撮影画像の結合PDF）はOCRへフォールバックする", async () => {
    const img = await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .jpeg()
      .toBuffer();
    const pdf = await mergeImagesToPdf([img, img]);
    await expect(extractDocumentText("撮影_2ページ.pdf", pdf)).resolves.toBe("PDF OCR結果");
  });

  it("テキスト層に日本語がほぼ無いPDF（フォント未埋め込みで日本語欠落）はOCR結果を採用する", async () => {
    // ASCII のみのテキスト層を持つPDF（日本語がフォント問題で抽出できなかった状態を再現）
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("Subject: AAS 20260731 From: yyamamoto Mobile 080-0000-0000", {
      x: 40, y: 800, size: 12, font,
    });
    const pdf = Buffer.from(await doc.save());
    // OCRモックは日本語（"PDF OCR結果" = CJK 2文字 > 0）を返すため、OCR側が採用される
    await expect(extractDocumentText("794.pdf", pdf)).resolves.toBe("PDF OCR結果");
  });

  it("画像ファイルはOCRされる", async () => {
    const img = await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .png()
      .toBuffer();
    await expect(extractDocumentText("photo.png", img)).resolves.toBe("画像OCR結果");
  });
});
