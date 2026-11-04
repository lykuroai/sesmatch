// OIDC（Authorization Code + PKCE）の最小実装（PRO版仕様書 §4.13）。Google Workspace・Microsoft Entra ID を想定。
//
// - Discovery（/.well-known/openid-configuration）で各エンドポイントを取得
// - ID トークンは JWKS の公開鍵で署名検証し、iss・aud・exp・nonce を確認する（jsonwebtoken + Node の JWK 取込）
// - ネットワーク呼び出しは fetch を差し替え可能にしてテストする

import { createHash, createPublicKey, randomBytes } from "crypto";
import jwt from "jsonwebtoken";

export type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

export type Jwk = { kid?: string; kty: string; alg?: string; use?: string; n?: string; e?: string; crv?: string; x?: string; y?: string };

type FetchLike = typeof fetch;

export async function discoverOidc(issuer: string, fetchImpl: FetchLike = fetch): Promise<OidcDiscovery> {
  const base = issuer.replace(/\/$/, "");
  const res = await fetchImpl(`${base}/.well-known/openid-configuration`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`OIDC Discovery に失敗しました（HTTP ${res.status}）`);
  const doc = (await res.json()) as Partial<OidcDiscovery>;
  if (!doc.issuer || !doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri)
    throw new Error("OIDC Discovery の応答に必要な項目がありません");
  return doc as OidcDiscovery;
}

export function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function buildAuthorizationUrl(params: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  loginHint?: string;
}): string {
  const url = new URL(params.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (params.loginHint) url.searchParams.set("login_hint", params.loginHint);
  return url.toString();
}

export async function exchangeCode(
  params: { tokenEndpoint: string; clientId: string; clientSecret: string; code: string; redirectUri: string; codeVerifier: string },
  fetchImpl: FetchLike = fetch
): Promise<{ idToken: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code_verifier: params.codeVerifier,
  });
  const res = await fetchImpl(params.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`トークン取得に失敗しました（HTTP ${res.status}）`);
  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token) throw new Error("トークン応答に id_token がありません");
  return { idToken: json.id_token };
}

export async function fetchJwks(jwksUri: string, fetchImpl: FetchLike = fetch): Promise<Jwk[]> {
  const res = await fetchImpl(jwksUri, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`JWKS の取得に失敗しました（HTTP ${res.status}）`);
  const json = (await res.json()) as { keys?: Jwk[] };
  return json.keys ?? [];
}

export type IdTokenClaims = { sub: string; email: string; emailVerified: boolean | null };

// ID トークンの検証: 署名（RS256/ES256）、iss、aud、exp、nonce。メールが無ければエラー
export function verifyIdToken(
  idToken: string,
  opts: { jwks: Jwk[]; issuer: string; clientId: string; nonce: string; now?: Date }
): IdTokenClaims {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || typeof decoded === "string") throw new Error("ID トークンの形式が不正です");
  const kid = decoded.header.kid;
  const candidates = opts.jwks.filter((k) => (kid ? k.kid === kid : true) && (!k.use || k.use === "sig"));
  if (candidates.length === 0) throw new Error("ID トークンの署名鍵が JWKS に見つかりません");
  let payload: jwt.JwtPayload | null = null;
  let lastError: unknown = null;
  for (const jwk of candidates) {
    try {
      const key = createPublicKey({ key: jwk as never, format: "jwk" });
      payload = jwt.verify(idToken, key, {
        algorithms: ["RS256", "RS384", "RS512", "ES256", "ES384"],
        audience: opts.clientId,
        issuer: [opts.issuer, opts.issuer.replace(/\/$/, "")],
        clockTimestamp: opts.now ? Math.floor(opts.now.getTime() / 1000) : undefined,
      }) as jwt.JwtPayload;
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (!payload) throw new Error(`ID トークンの検証に失敗しました: ${lastError instanceof Error ? lastError.message : "unknown"}`);
  if (payload.nonce !== opts.nonce) throw new Error("ID トークンの nonce が一致しません");
  const email = typeof payload.email === "string" ? payload.email : typeof payload.preferred_username === "string" && payload.preferred_username.includes("@") ? payload.preferred_username : null;
  if (!email || typeof payload.sub !== "string") throw new Error("ID トークンにメールアドレスが含まれていません（IdP で email スコープを許可してください）");
  return { sub: payload.sub, email: email.toLowerCase(), emailVerified: typeof payload.email_verified === "boolean" ? payload.email_verified : null };
}
