// TOTP（RFC 6238 / HMAC-SHA1・30秒・6桁）の純粋実装。外部依存なし。テスト対象
import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// 20バイト（160bit）の秘密鍵を base32 で返す（Google Authenticator 等で入力可）
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secretBase32: string, counter: number, digits = 6): string {
  const key = base32Decode(secretBase32);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", key).update(msg).digest();
  const offset = h[h.length - 1] & 0x0f;
  const code = ((h[offset] & 0x7f) << 24) | ((h[offset + 1] & 0xff) << 16) | ((h[offset + 2] & 0xff) << 8) | (h[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, "0");
}

export function totp(secretBase32: string, at: Date = new Date(), stepSec = 30, digits = 6): string {
  return hotp(secretBase32, Math.floor(at.getTime() / 1000 / stepSec), digits);
}

// 前後1ステップ（±30秒）の時刻ずれを許容して照合する
export function verifyTotp(secretBase32: string, code: string, at: Date = new Date(), window = 1): boolean {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  const counter = Math.floor(at.getTime() / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    const expected = hotp(secretBase32, counter + w);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return true;
  }
  return false;
}

export function otpauthUrl(issuer: string, account: string, secretBase32: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// バックアップコード（10個・8桁の英数字）
export function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, () => randomBytes(5).toString("hex").slice(0, 8).toUpperCase());
}
