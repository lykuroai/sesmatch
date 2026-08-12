import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { extractDocumentText, stripPdfPageMarkers } from "../src/server/pipeline/extract-text";
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

describe("extractDocumentText のOCRルーティング", () => {
  beforeEach(() => vi.clearAllMocks());

  it("テキスト層のないPDF（撮影画像の結合PDF）はOCRへフォールバックする", async () => {
    const img = await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .jpeg()
      .toBuffer();
    const pdf = await mergeImagesToPdf([img, img]);
    await expect(extractDocumentText("撮影_2ページ.pdf", pdf)).resolves.toBe("PDF OCR結果");
  });

  it("画像ファイルはOCRされる", async () => {
    const img = await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .png()
      .toBuffer();
    await expect(extractDocumentText("photo.png", img)).resolves.toBe("画像OCR結果");
  });
});
