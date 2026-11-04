// SSO の純粋ロジック（PRO版仕様書 §4.13）: 署名付き状態、OIDC の認可 URL と ID トークン検証、SAML の補助関数
import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";
import { signSsoState, verifySsoState } from "@/server/auth/sso/state";
import { buildAuthorizationUrl, generatePkce, verifyIdToken, type Jwk } from "@/server/auth/sso/oidc";
import { emailFromProfile, normalizeCert, samlAuthorizeUrl, samlMetadata } from "@/server/auth/sso/saml";

describe("SSO の状態 Cookie", () => {
  const base = { companyId: "c1", provider: "OIDC" as const, state: "st", nonce: "n", codeVerifier: "v", exp: Date.now() + 60_000 };
  it("署名を検証して復元する", () => {
    const v = signSsoState(base);
    expect(verifySsoState(v)).toEqual(base);
  });
  it("改ざん・鍵違い・期限切れ・不正形式は null", () => {
    const v = signSsoState(base);
    expect(verifySsoState(v.slice(0, -2) + "zz")).toBeNull();
    expect(verifySsoState(v, Date.now(), "other-key")).toBeNull();
    expect(verifySsoState(signSsoState({ ...base, exp: Date.now() - 1 }))).toBeNull();
    expect(verifySsoState("garbage")).toBeNull();
    expect(verifySsoState(undefined)).toBeNull();
  });
});

describe("OIDC", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: "jwk" }) as Jwk), kid: "k1", use: "sig" };
  const issuer = "https://idp.example.com";
  const clientId = "client-abc";
  const sign = (claims: Record<string, unknown>, opts: jwt.SignOptions = {}) =>
    jwt.sign({ iss: issuer, aud: clientId, sub: "u1", email: "User@Example.com", email_verified: true, nonce: "n1", ...claims }, privateKey, { algorithm: "RS256", keyid: "k1", expiresIn: "5m", ...opts });

  it("認可 URL に必須パラメータが付く", () => {
    const { codeChallenge } = generatePkce();
    const url = new URL(buildAuthorizationUrl({ authorizationEndpoint: `${issuer}/auth`, clientId, redirectUri: "https://app/cb", state: "s", nonce: "n", codeChallenge }));
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("email");
    expect(url.searchParams.get("state")).toBe("s");
  });
  it("ID トークンを検証しメールを小文字で返す", () => {
    const claims = verifyIdToken(sign({}), { jwks: [jwk], issuer, clientId, nonce: "n1" });
    expect(claims).toEqual({ sub: "u1", email: "user@example.com", emailVerified: true });
  });
  it("nonce 不一致・aud 違い・iss 違い・別鍵・期限切れ・メール無しを拒否する", () => {
    expect(() => verifyIdToken(sign({}), { jwks: [jwk], issuer, clientId, nonce: "other" })).toThrow(/nonce/);
    expect(() => verifyIdToken(sign({ aud: "someone-else" }), { jwks: [jwk], issuer, clientId, nonce: "n1" })).toThrow();
    expect(() => verifyIdToken(sign({ iss: "https://evil.example.com" }), { jwks: [jwk], issuer, clientId, nonce: "n1" })).toThrow();
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const otherJwk = { ...(other.publicKey.export({ format: "jwk" }) as Jwk), kid: "k1" };
    expect(() => verifyIdToken(sign({}), { jwks: [otherJwk], issuer, clientId, nonce: "n1" })).toThrow();
    expect(() => verifyIdToken(sign({}, { expiresIn: "-1m" }), { jwks: [jwk], issuer, clientId, nonce: "n1" })).toThrow();
    expect(() => verifyIdToken(sign({ email: undefined }), { jwks: [jwk], issuer, clientId, nonce: "n1" })).toThrow(/メール/);
  });
});

describe("SAML", () => {
  // テスト用の自己署名証明書（検証には使わず、設定値の形式確認のみ）
  const pem = `-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUXz\nabc+/=\n-----END CERTIFICATE-----`;
  it("PEM を base64 本文に正規化する", () => {
    expect(normalizeCert(pem)).toBe("MIIBszCCAVmgAwIBAgIUXzabc+/=");
  });
  it("メールの取り出し順（email → Entra クレーム → NameID）", () => {
    expect(emailFromProfile({ issuer: "i", nameID: "x", nameIDFormat: "f", email: "A@b.com" })).toBe("a@b.com");
    expect(emailFromProfile({ issuer: "i", nameID: "x", nameIDFormat: "f", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress": "c@d.com" } as never)).toBe("c@d.com");
    expect(emailFromProfile({ issuer: "i", nameID: "e@f.com", nameIDFormat: "f" })).toBe("e@f.com");
    expect(emailFromProfile({ issuer: "i", nameID: "opaque", nameIDFormat: "f" })).toBeNull();
  });
  it("認可 URL と SP メタデータを生成する", async () => {
    const sp = { entityId: "https://app.example/api/v1/auth/sso/metadata", callbackUrl: "https://app.example/api/v1/auth/sso/callback" };
    const url = await samlAuthorizeUrl({ entryPoint: "https://idp.example/sso", idpCert: "MIIB" }, sp, "relay-1");
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://idp.example/sso");
    expect(u.searchParams.get("SAMLRequest")).toBeTruthy();
    expect(u.searchParams.get("RelayState")).toBe("relay-1");
    const xml = samlMetadata(null, sp);
    expect(xml).toContain(`entityID="${sp.entityId}"`);
    expect(xml).toContain(sp.callbackUrl);
  });
});
