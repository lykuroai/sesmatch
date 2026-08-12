// 複数ページ画像の結合（§9.2）: スマホで1ページずつ撮影した書類を
// 1画像=1ページのPDFへ結合し、1件の原本として保存・OCR処理する。
// 結合後は extract-text.ts の画像PDFフォールバック（pdftoppm → tesseract）で文字起こしされる。
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

// ocr.ts の MAX_PDF_OCR_PAGES と揃える（これを超えるページはOCRされないため受け付けない）
export const MAX_MERGE_IMAGES = 10;

export function isImageFilename(name: string): boolean {
  return /\.(jpe?g|png|webp)$/i.test(name);
}

export async function mergeImagesToPdf(images: Buffer[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (const buf of images) {
    // EXIF回転を反映し、過大な写真は縮小してJPEG化（200dpiのOCR描画には十分な解像度）
    const jpeg = await sharp(buf, { failOn: "none" })
      .rotate()
      .resize({ width: 2400, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const img = await doc.embedJpg(jpeg);
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  return Buffer.from(await doc.save());
}
