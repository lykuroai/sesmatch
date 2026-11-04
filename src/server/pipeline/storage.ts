// 原本ストレージの軽量ユーティリティ（取込・スキルシート添付で共用）。
// OCR（sharp 等のネイティブ依存）を含む extract-text / ingest を読み込まずに使えるよう分離している
// （保存検索の評価など、instrumentation.ts から起動する定期処理の import 連鎖に重い依存を入れないため）
import path from "path";

export const STORAGE_DIR = process.env.STORAGE_DIR ?? "./storage";

// 保存用ファイル名をUTF-8のバイト長で安全に切り詰める（ext4等の255バイト制限対策。拡張子は保持）。
// 表示用の filename（DB）は切り詰めず、ディスク上のパスだけを短くする。
// パストラバーサル対策（§31）: ディレクトリ区切り・先頭ドットを除去し、保存先ディレクトリの
// 脱出（`../` 等による他テナント領域や任意パスへの書き込み）を防ぐ。
export function truncateFilenameBytes(filename: string, maxBytes: number): string {
  const safe = path
    .basename(filename) // ディレクトリ部を除去（posixのセパレータ）
    .replace(/[/\\]/g, "_") // 残存する区切り（Windows形式等）も無効化
    .replace(/^\.+/, ""); // 先頭ドット（`..` 等）を除去
  const ext = path.extname(safe).slice(0, 20);
  const base = safe.slice(0, safe.length - ext.length);
  const budget = maxBytes - Buffer.byteLength(ext, "utf-8");
  let out = "";
  for (const ch of base) {
    if (Buffer.byteLength(out + ch, "utf-8") > budget) break;
    out += ch;
  }
  return (out || "document") + ext;
}
