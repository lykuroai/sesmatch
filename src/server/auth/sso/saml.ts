// SAML 2.0（SP-initiated、HTTP-Redirect で要求・HTTP-POST で応答）の薄いラッパー（PRO版仕様書 §4.13）。
// 署名検証・条件検証は @node-saml/node-saml に委ねる。
//
// - IdP の証明書（PEM または base64 本文）で応答の署名を検証する。アサーション署名を必須とする
//   （Entra ID・Google Workspace の既定はアサーション署名）
// - InResponseTo の照合は行わず（複数プロセス化を考慮）、RelayState を署名付き Cookie の state と突き合わせる
// - メールは email 属性 → Entra の emailaddress クレーム → NameID（メール形式）の順で取る

import { SAML, ValidateInResponseTo, type Profile } from "@node-saml/node-saml";

export type SamlConfig = { entryPoint: string; idpCert: string; idpIssuer?: string };
export type SamlSp = { entityId: string; callbackUrl: string };

// 証明書入力のゆらぎ（PEM ヘッダ有無・改行）を吸収して base64 本文にする
export function normalizeCert(input: string): string {
  return input
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
}

export function samlInstance(cfg: SamlConfig, sp: SamlSp): SAML {
  return new SAML({
    entryPoint: cfg.entryPoint,
    idpCert: normalizeCert(cfg.idpCert),
    idpIssuer: cfg.idpIssuer || undefined,
    issuer: sp.entityId,
    callbackUrl: sp.callbackUrl,
    audience: sp.entityId,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    validateInResponseTo: ValidateInResponseTo.never,
    identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    acceptedClockSkewMs: 60 * 1000,
    disableRequestedAuthnContext: true,
  });
}

export async function samlAuthorizeUrl(cfg: SamlConfig, sp: SamlSp, relayState: string): Promise<string> {
  return samlInstance(cfg, sp).getAuthorizeUrlAsync(relayState, {});
}

export function samlMetadata(cfg: SamlConfig | null, sp: SamlSp): string {
  const saml = samlInstance(cfg ?? { entryPoint: "https://example.invalid/sso", idpCert: "AA==" }, sp);
  return saml.generateServiceProviderMetadata(null, null);
}

const ENTRA_EMAIL_CLAIM = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress";

export function emailFromProfile(profile: Profile): string | null {
  const p = profile as Profile & Record<string, unknown>;
  const candidates = [p.email, p.mail, p[ENTRA_EMAIL_CLAIM], p["urn:oid:0.9.2342.19200300.100.1.3"], profile.nameID];
  for (const c of candidates) {
    const v = Array.isArray(c) ? c[0] : c;
    if (typeof v === "string" && v.includes("@")) return v.trim().toLowerCase();
  }
  return null;
}

// POST された SAMLResponse を検証してメールアドレスを返す
export async function samlValidateResponse(cfg: SamlConfig, sp: SamlSp, body: { SAMLResponse: string; RelayState?: string }): Promise<{ email: string; nameId: string }> {
  const { profile, loggedOut } = await samlInstance(cfg, sp).validatePostResponseAsync(body);
  if (loggedOut || !profile) throw new Error("SAML 応答にログイン情報がありません");
  const email = emailFromProfile(profile);
  if (!email) throw new Error("SAML 応答にメールアドレスが含まれていません（IdP の属性設定で email を送ってください）");
  return { email, nameId: profile.nameID };
}
