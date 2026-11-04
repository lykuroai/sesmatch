// SSO ログインの流れ（PRO版仕様書 §4.13）
//
//   GET /auth/sso/:slug/start → IdP へリダイレクト（state 等は署名付き Cookie に保持）
//   GET|POST /auth/sso/callback → 応答を検証 → メールアドレスで既存メンバーを照合 → セッション発行
//
// - JIT プロビジョニング（メンバーの自動作成）は行わない。メールが一致する ACTIVE メンバーのみ
// - 対象企業は開始時の Cookie に固定し、他社の IdP アサーションでは照合しない（テナント分離）
// - SSO ログインでは認証アプリのコード入力を求めない（IdP の認証に委ねる）。企業の2要素必須化のゲートは従来どおり
// - 失敗は監査に理由のみ記録する（メールアドレスは書かない）

import { randomBytes } from "crypto";
import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import { findSsoCompanyBySlug, ssoServiceProvider } from "@/server/auth/security";
import { buildAuthorizationUrl, discoverOidc, exchangeCode, fetchJwks, generatePkce, verifyIdToken } from "./oidc";
import { samlAuthorizeUrl, samlValidateResponse } from "./saml";
import { signSsoState, SSO_STATE_TTL_MS, verifySsoState, type SsoState } from "./state";

export type SsoStartResult = { redirectUrl: string; stateCookie: string } | { error: string };

type Deps = { fetchImpl?: typeof fetch }; // テストで IdP を差し替える

export async function startSso(slug: string, opts: { loginHint?: string } & Deps = {}): Promise<SsoStartResult> {
  const target = await findSsoCompanyBySlug(slug);
  if (!target) return { error: "SSO が設定されていないか、利用できない企業識別子です" };
  const sp = ssoServiceProvider();
  const state = randomBytes(16).toString("base64url");
  const base: Omit<SsoState, "provider"> = { companyId: target.companyId, state, exp: Date.now() + SSO_STATE_TTL_MS };
  try {
    if (target.config.provider === "OIDC") {
      const disc = await discoverOidc(target.config.issuer, opts.fetchImpl);
      const nonce = randomBytes(16).toString("base64url");
      const { codeVerifier, codeChallenge } = generatePkce();
      const redirectUrl = buildAuthorizationUrl({
        authorizationEndpoint: disc.authorization_endpoint,
        clientId: target.config.clientId,
        redirectUri: sp.redirectUri,
        state,
        nonce,
        codeChallenge,
        loginHint: opts.loginHint,
      });
      return { redirectUrl, stateCookie: signSsoState({ ...base, provider: "OIDC", nonce, codeVerifier }) };
    }
    const redirectUrl = await samlAuthorizeUrl(target.config, { entityId: sp.entityId, callbackUrl: sp.acsUrl }, state);
    return { redirectUrl, stateCookie: signSsoState({ ...base, provider: "SAML" }) };
  } catch (e) {
    await audit({ tenantCompanyId: target.companyId, action: "SsoLoginFailed", metadata: { stage: "start", reason: e instanceof Error ? e.message : "unknown" } });
    return { error: `IdP への接続に失敗しました: ${e instanceof Error ? e.message : "unknown"}` };
  }
}

export type SsoCallbackInput = {
  stateCookie: string | undefined;
  query: Record<string, string | undefined>; // OIDC: code, state, error
  form?: Record<string, string | undefined>; // SAML: SAMLResponse, RelayState
};

export type SsoCompleteResult = { userAccountId: string; companyId: string } | { error: string; companyId?: string };

export async function completeSso(input: SsoCallbackInput, deps: Deps = {}): Promise<SsoCompleteResult> {
  const st = verifySsoState(input.stateCookie);
  if (!st) return { error: "SSO の開始情報が見つからないか期限切れです。最初からやり直してください" };
  const fail = async (reason: string, message = reason) => {
    await audit({ tenantCompanyId: st.companyId, action: "SsoLoginFailed", metadata: { stage: "callback", provider: st.provider, reason } });
    return { error: message, companyId: st.companyId };
  };
  const settings = await prisma.companySecuritySettings.findUnique({ where: { companyId: st.companyId } });
  const target = settings?.ssoSlug ? await findSsoCompanyBySlug(settings.ssoSlug) : null;
  if (!target || target.companyId !== st.companyId || target.config.provider !== st.provider) return fail("sso_not_available", "SSO が利用できません（設定変更またはプラン変更）");
  const sp = ssoServiceProvider();

  let email: string;
  try {
    if (st.provider === "OIDC") {
      if (target.config.provider !== "OIDC") return fail("provider_mismatch");
      if (input.query.error) return fail(`idp_error:${input.query.error}`, `IdP がログインを拒否しました（${input.query.error}）`);
      if (!input.query.code || input.query.state !== st.state) return fail("state_mismatch", "state が一致しません。最初からやり直してください");
      const disc = await discoverOidc(target.config.issuer, deps.fetchImpl);
      const { idToken } = await exchangeCode(
        {
          tokenEndpoint: disc.token_endpoint,
          clientId: target.config.clientId,
          clientSecret: target.config.clientSecret,
          code: input.query.code,
          redirectUri: sp.redirectUri,
          codeVerifier: st.codeVerifier ?? "",
        },
        deps.fetchImpl
      );
      const jwks = await fetchJwks(disc.jwks_uri, deps.fetchImpl);
      const claims = verifyIdToken(idToken, { jwks, issuer: disc.issuer, clientId: target.config.clientId, nonce: st.nonce ?? "" });
      email = claims.email;
    } else {
      if (target.config.provider !== "SAML") return fail("provider_mismatch");
      const samlResponse = input.form?.SAMLResponse;
      if (!samlResponse) return fail("no_saml_response", "SAML 応答がありません");
      if ((input.form?.RelayState ?? "") !== st.state) return fail("relay_state_mismatch", "RelayState が一致しません。最初からやり直してください");
      const r = await samlValidateResponse(target.config, { entityId: sp.entityId, callbackUrl: sp.acsUrl }, { SAMLResponse: samlResponse, RelayState: input.form?.RelayState });
      email = r.email;
    }
  } catch (e) {
    return fail("verify_failed", `IdP の応答を検証できませんでした: ${e instanceof Error ? e.message : "unknown"}`);
  }

  // 既存メンバーとメールで照合（自動作成しない）。企業は Cookie に固定した1社のみ
  const account = await prisma.userAccount.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  const member = account
    ? await prisma.companyMember.findFirst({ where: { userAccountId: account.id, companyId: st.companyId, status: "ACTIVE" } })
    : null;
  if (!account || !member) return fail("member_not_found", "IdP のメールアドレスに一致する担当者が登録されていません。代表に招待を依頼してください");
  await audit({ tenantCompanyId: st.companyId, actorUserId: account.id, action: "LoginSucceeded", metadata: { sso: st.provider } });
  return { userAccountId: account.id, companyId: st.companyId };
}
