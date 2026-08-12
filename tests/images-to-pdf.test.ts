import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { mergeImagesToPdf } from "../src/server/pipeline/images-to-pdf";

async function testImage(color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 300, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}

describe("mergeImagesToPdf", () => {
  it("画像N枚を1画像=1ページのPDFに結合する", async () => {
    const images = [
      await testImage({ r: 255, g: 255, b: 255 }),
      await testImage({ r: 240, g: 240, b: 240 }),
      await testImage({ r: 230, g: 230, b: 230 }),
    ];
    const pdf = await mergeImagesToPdf(images);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(3);
  });

  it("1枚でも有効なPDFを生成する", async () => {
    const pdf = await mergeImagesToPdf([await testImage({ r: 255, g: 255, b: 255 })]);
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
  });
});
