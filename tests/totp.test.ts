// TOTP（RFC 6238）と base32 の純粋ロジック（PRO版仕様書 §4.11）
import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateBackupCodes, generateTotpSecret, hotp, otpauthUrl, totp, verifyTotp } from "@/server/auth/totp";

// RFC 6238 付録B のテストベクタ（HMAC-SHA1、秘密鍵 "12345678901234567890"）。8桁値の下6桁で照合
const SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("totp", () => {
  it("RFC 6238 のテストベクタに一致する", () => {
    expect(totp(SECRET, new Date(59 * 1000))).toBe("287082"); // 94287082
    expect(totp(SECRET, new Date(1111111109 * 1000))).toBe("081804"); // 07081804
    expect(totp(SECRET, new Date(1234567890 * 1000))).toBe("005924"); // 89005924
    expect(totp(SECRET, new Date(20000000000 * 1000))).toBe("353130"); // 65353130
  });
  it("hotp は RFC 4226 のカウンタ 0〜2 に一致する", () => {
    expect(hotp(SECRET, 0)).toBe("755224");
    expect(hotp(SECRET, 1)).toBe("287082");
    expect(hotp(SECRET, 2)).toBe("359152");
  });
  it("±1ステップのずれを許容し、それ以上・形式不正は拒否する", () => {
    const at = new Date(1234567890 * 1000);
    expect(verifyTotp(SECRET, "005924", at)).toBe(true);
    expect(verifyTotp(SECRET, "005924", new Date(at.getTime() + 30_000))).toBe(true);
    expect(verifyTotp(SECRET, "005924", new Date(at.getTime() + 90_000))).toBe(false);
    expect(verifyTotp(SECRET, "00592", at)).toBe(false);
    expect(verifyTotp(SECRET, "abcdef", at)).toBe(false);
  });
  it("base32 は往復でき、秘密鍵は32文字、バックアップコードは10個8桁、otpauth URL を組み立てる", () => {
    expect(base32Decode(base32Encode(Buffer.from("hello"))).toString()).toBe("hello");
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(codes.every((c) => /^[0-9A-F]{8}$/.test(c))).toBe(true);
    expect(otpauthUrl("SES DirectMatch", "a@example.com", "ABC")).toBe("otpauth://totp/SES%20DirectMatch%3Aa%40example.com?secret=ABC&issuer=SES%20DirectMatch&algorithm=SHA1&digits=6&period=30");
  });
});
