// SSO の往復状態（state・nonce・PKCE verifier・対象企業）を HMAC 署名付き Cookie に保持する（PRO版仕様書 §4.13）。
// サーバ側テーブルを持たず、改ざんは署名で検出する。有効期限 10 分。純粋ロジック（テスト対象）

import { createHmac, timingSafeEqual } from "crypto";

export const SSO_STATE_COOKIE = "sesmatch_sso";
export const SSO_STATE_TTL_MS = 10 * 60 * 1000;

export type SsoState = {
  companyId: string;
  provider: "OIDC" | "SAML";
  state: string; // OIDC の state ／ SAML の RelayState
  nonce?: string; // OIDC
  codeVerifier?: string; // OIDC PKCE
  exp: number; // epoch ms
};

const secret = () => process.env.SESSION_SECRET || "sesmatch-dev-secret";
const b64u = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");
const sign = (payload: string, key = secret()) => createHmac("sha256", `sso-state:${key}`).update(payload).digest("base64url");

export function signSsoState(state: SsoState, key?: string): string {
  const payload = b64u(JSON.stringify(state));
  return `${payload}.${sign(payload, key)}`;
}

// 署名と期限を検証して復元する。不正・期限切れは null
export function verifySsoState(value: string | undefined, now = Date.now(), key?: string): SsoState | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = sign(payload, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SsoState;
    if (!parsed || typeof parsed.companyId !== "string" || typeof parsed.state !== "string") return null;
    if (typeof parsed.exp !== "number" || parsed.exp < now) return null;
    return parsed;
  } catch {
    return null;
  }
}
