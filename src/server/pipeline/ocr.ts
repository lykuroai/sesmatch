// ローカルOCR（§9.2 / §25）: 撮影画像・画像PDFをサーバー内で文字起こしする。
// 原本画像は氏名・顔写真等のPIIを含み得るため、外部サービス・LLMには一切送らず、
// tesseract CLI（jpn+eng）で処理する。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const execFileP = promisify(execFile);
const EXEC_OPTS = { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 };

// カメラ撮影・スクリーンショットで一般的な形式のみ受け付ける
export const OCR_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

// 画像PDFのOCR対象ページ上限（DoS・処理時間対策。スキルシート・案件票は通常数ページ）
const MAX_PDF_OCR_PAGES = 10;

// tesseract の日本語出力は文字間に不要な半角スペースが入るため除去する
// （日本語文字に挟まれたスペースのみ。英数字間のスペースは保持）
const JP = "[\\u3000-\\u303f\\u3040-\\u30ff\\u4e00-\\u9fff\\uff01-\\uff60]";
// 日本語⇄日本語、日本語⇄数字の間のスペースを除去（英単語間 "Java Spring" は保持）
const JP_SPACE_1 = new RegExp(`(?<=${JP}) +(?=${JP}|[0-9])`, "g");
const JP_SPACE_2 = new RegExp(`(?<=[0-9]) +(?=${JP})`, "g");
// 日本語モデルは数字を丸数字（①⑳等）に誤認識しやすいため通常の数字へ正規化する
const CIRCLED = /[①-⑳]/g; // ①〜⑳
export function cleanOcrText(raw: string): string {
  return raw
    .replace(CIRCLED, (c) => String(c.charCodeAt(0) - 0x2460 + 1))
    .replace(JP_SPACE_1, "")
    .replace(JP_SPACE_2, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// OCR前処理: EXIF回転補正・グレースケール・コントラスト正規化・小さい写真の拡大
async function preprocessImage(content: Buffer): Promise<Buffer> {
  const img = sharp(content, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const width = meta.width ?? 0;
  const scaled = width > 0 && width < 2000 ? img.resize({ width: 2000 }) : img;
  return scaled.grayscale().normalize().png().toBuffer();
}

async function runTesseract(pngPath: string): Promise<string> {
  const outBase = pngPath.replace(/\.png$/, "");
  try {
    await execFileP("tesseract", [pngPath, outBase, "-l", "jpn+eng"], EXEC_OPTS);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error("OCR環境（tesseract）が未設定のため、画像の取込ができません");
    throw e;
  }
  return readFile(`${outBase}.txt`, "utf-8");
}

// 撮影画像（JPEG/PNG/WebP）→ テキスト
export async function ocrImage(content: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "sesmatch-ocr-"));
  try {
    const png = path.join(dir, "in.png");
    await writeFile(png, await preprocessImage(content));
    return cleanOcrText(await runTesseract(png));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// 画像PDF → ページを 200dpi で画像化（pdftoppm）→ ページごとにOCR
export async function ocrPdf(content: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "sesmatch-ocr-pdf-"));
  try {
    const pdf = path.join(dir, "in.pdf");
    await writeFile(pdf, content);
    try {
      await execFileP(
        "pdftoppm",
        ["-png", "-gray", "-r", "200", "-l", String(MAX_PDF_OCR_PAGES), pdf, path.join(dir, "page")],
        EXEC_OPTS
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error("OCR環境（poppler）が未設定のため、画像PDFの取込ができません");
      throw e;
    }
    const pages = (await readdir(dir)).filter((f) => f.startsWith("page") && f.endsWith(".png")).sort();
    const parts: string[] = [];
    for (const p of pages) {
      const text = cleanOcrText(await runTesseract(path.join(dir, p)));
      if (text) parts.push(text);
    }
    return parts.join("\n\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
