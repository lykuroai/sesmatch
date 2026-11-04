// 保存データの対称暗号（AES-256-GCM）。Webhook URL・2要素認証の秘密鍵・SSO 設定などの秘匿値に使う。
// 鍵は DATA_ENCRYPTION_KEY（32バイトの hex）。未設定時は SESSION_SECRET から派生させる（本番は専用鍵を推奨）。
// 出力形式: "v1:" + base64(iv) + ":" + base64(tag) + ":" + base64(ciphertext)

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

function key(): Buffer {
  const hex = process.env.DATA_ENCRYPTION_KEY;
  if (hex && /^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, "hex");
  const secret = process.env.SESSION_SECRET || "sesmatch-dev-secret";
  return createHash("sha256").update(`data-encryption:${secret}`).digest();
}

export function encryptString(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptString(stored: string): string {
  const [v, ivB, tagB, encB] = stored.split(":");
  if (v !== "v1" || !ivB || !tagB || !encB) throw new Error("暗号化データの形式が不正です");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encB, "base64")), decipher.final()]).toString("utf8");
}
