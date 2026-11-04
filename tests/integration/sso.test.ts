// SSO（PRO版仕様書 §4.13, §13）の統合テスト。OIDC の IdP は fetch を差し替えて模擬する。専用DB sesmatch_test
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "@/server/db";
import { addMemberWithRoles, makeCompany, setPlan, truncateAll } from "./helpers";
import { findSsoCompanyBySlug, setSsoSettings } from "@/server/auth/security";
import { completeSso, startSso } from "@/server/auth/sso";
import { verifySsoState } from "@/server/auth/sso/state";
import { hashPassword } from "@/server/auth/password";
import { app } from "@/server/api/app";

vi.mock("@/server/mail", () => ({ appBaseUrl: () => "http://test.local", sendMail: async () => {} }));

beforeEach(async () => {
  await truncateAll();
});

// ---- 模擬 IdP（OIDC）----
const ISSUER = "https://idp.test.example";
const CLIENT_ID = "client-1";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as Record<string, string>), kid: "k1", use: "sig" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function fakeIdp(opts: { email: string; nonceOf: () => string; iss?: string }) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === `${ISSUER}/.well-known/openid-configuration`)
      return json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks` });
    if (url === `${ISSUER}/jwks`) return json({ keys: [jwk] });
    if (url === `${ISSUER}/token`) {
      const params = new URLSearchParams(String(init?.body));
      if (params.get("code") !== "good-code" || !params.get("code_verifier")) return json({ error: "invalid_grant" }, 400);
      const idToken = jwt.sign(
        { iss: opts.iss ?? ISSUER, aud: CLIENT_ID, sub: "idp-user", email: opts.email, email_verified: true, nonce: opts.nonceOf() },
        privateKey,
        { algorithm: "RS256", keyid: "k1", expiresIn: "5m" }
      );
      return json({ id_token: idToken, access_token: "x", token_type: "Bearer" });
    }
    return json({ error: "not found" }, 404);
  }) as typeof fetch;
}

const oidcInput = (slug: string, secret = "secret-1") => ({ provider: "OIDC" as const, slug, oidc: { issuer: ISSUER, clientId: CLIENT_ID, clientSecret: secret } });

describe("SSO 設定", () => {
  it("基本版は設定できない。PRO は暗号化保存し、識別子は一意", async () => {
    const free = await makeCompany("SSO株式会社");
    expect(await setSsoSettings(free, oidcInput("sso-inc"))).toMatchObject({ error: { code: "PLAN_REQUIRED" } });
    const pro = await setPlan(free, "PRO");
    expect(await setSsoSettings(pro, { ...oidcInput("bad slug!") })).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(await setSsoSettings(pro, oidcInput("sso-inc"))).toEqual({ ok: true });
    const row = await prisma.companySecuritySettings.findUniqueOrThrow({ where: { companyId: pro.companyId } });
    expect(row.ssoProvider).toBe("OIDC");
    expect(row.ssoSlug).toBe("sso-inc");
    expect(row.ssoConfigEncrypted).not.toContain("secret-1");
    expect((await findSsoCompanyBySlug("sso-inc"))?.config).toMatchObject({ provider: "OIDC", clientSecret: "secret-1" });
    // シークレット省略時は既存を維持
    expect(await setSsoSettings(pro, { provider: "OIDC", slug: "sso-inc", oidc: { issuer: ISSUER, clientId: CLIENT_ID } })).toEqual({ ok: true });
    expect((await findSsoCompanyBySlug("sso-inc"))?.config).toMatchObject({ clientSecret: "secret-1" });
    // 他社は同じ識別子を使えない
    const other = await setPlan(await makeCompany("別の会社"), "PRO");
    expect(await setSsoSettings(other, oidcInput("sso-inc"))).toMatchObject({ error: { code: "VERSION_CONFLICT" } });
    // 必須化は設定済みのときだけ
    expect(await setSsoSettings(other, { provider: "NONE", required: true })).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    // 解除
    expect(await setSsoSettings(pro, { provider: "NONE" })).toEqual({ ok: true });
    expect(await findSsoCompanyBySlug("sso-inc")).toBeNull();
    expect(await prisma.auditEvent.count({ where: { tenantCompanyId: pro.companyId, action: "SsoSettingsChanged" } })).toBe(3);
  });
});

describe("SSO ログイン（OIDC）", () => {
  it("メール一致の既存メンバーのみログインでき、他社メンバー・未登録メールは拒否", async () => {
    const owner = await setPlan(await makeCompany("SSO株式会社"), "PRO");
    const staff = await addMemberWithRoles(owner, ["SALES"]);
    await setSsoSettings(owner, oidcInput("sso-inc"));
    const otherCompany = await makeCompany("他社");

    const run = async (email: string) => {
      let nonce = "";
      const idp = fakeIdp({ email, nonceOf: () => nonce });
      const started = await startSso("sso-inc", { fetchImpl: idp });
      if ("error" in started) throw new Error(started.error);
      const st = verifySsoState(started.stateCookie)!;
      nonce = st.nonce!;
      expect(started.redirectUrl.startsWith(`${ISSUER}/auth?`)).toBe(true);
      return completeSso({ stateCookie: started.stateCookie, query: { code: "good-code", state: st.state } }, { fetchImpl: idp });
    };
    // 自社メンバー（大文字小文字は無視）
    expect(await run(staff.email.toUpperCase())).toEqual({ userAccountId: staff.userAccountId, companyId: owner.companyId });
    // 他社のメンバーのメール → 拒否（テナント分離）
    expect(await run(otherCompany.email)).toMatchObject({ error: expect.stringContaining("一致する担当者") });
    // 未登録
    expect(await run("nobody@example.com")).toMatchObject({ error: expect.stringContaining("一致する担当者") });
    expect(await prisma.auditEvent.count({ where: { tenantCompanyId: owner.companyId, action: "SsoLoginFailed" } })).toBe(2);
    expect(await prisma.auditEvent.count({ where: { tenantCompanyId: owner.companyId, action: "LoginSucceeded" } })).toBe(1);
  });

  it("state 不一致・別 issuer の ID トークン・Cookie 無しは拒否。PRO でなくなれば SSO 不可", async () => {
    const owner = await setPlan(await makeCompany("SSO株式会社"), "PRO");
    await setSsoSettings(owner, oidcInput("sso-inc"));
    let nonce = "";
    const idp = fakeIdp({ email: owner.email, nonceOf: () => nonce });
    const started = await startSso("sso-inc", { fetchImpl: idp });
    if ("error" in started) throw new Error(started.error);
    const st = verifySsoState(started.stateCookie)!;
    nonce = st.nonce!;
    expect(await completeSso({ stateCookie: started.stateCookie, query: { code: "good-code", state: "wrong" } }, { fetchImpl: idp })).toMatchObject({ error: expect.stringContaining("state") });
    expect(await completeSso({ stateCookie: undefined, query: { code: "good-code", state: st.state } }, { fetchImpl: idp })).toMatchObject({ error: expect.stringContaining("開始情報") });
    const evil = fakeIdp({ email: owner.email, nonceOf: () => nonce, iss: "https://evil.example" });
    expect(await completeSso({ stateCookie: started.stateCookie, query: { code: "good-code", state: st.state } }, { fetchImpl: evil })).toMatchObject({ error: expect.stringContaining("検証できません") });
    // 期限切れ → SSO 不可
    await setPlan(owner, "PRO", new Date(Date.now() - 1000));
    expect(await startSso("sso-inc", { fetchImpl: idp })).toMatchObject({ error: expect.stringContaining("利用できない") });
    expect(await completeSso({ stateCookie: started.stateCookie, query: { code: "good-code", state: st.state } }, { fetchImpl: idp })).toMatchObject({ error: expect.stringContaining("利用できません") });
  });

  it("SSO 必須化後は代表以外のパスワードログインを拒否し、代表はログインできる", async () => {
    const owner = await setPlan(await makeCompany("必須株式会社"), "PRO");
    const staff = await addMemberWithRoles(owner, ["SALES"]);
    for (const a of [owner, staff])
      await prisma.userAccount.update({ where: { id: a.userAccountId }, data: { passwordHash: await hashPassword("password123") } });
    await setSsoSettings(owner, { ...oidcInput("must-inc"), required: true });
    const login = (email: string) =>
      app.request("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "password123" }) });
    const denied = await login(staff.email);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: "SSO_REQUIRED", ssoSlug: "must-inc" } });
    expect((await login(owner.email)).status).toBe(200);
    // 解除後は通常ログイン可
    await setSsoSettings(owner, { ...oidcInput("must-inc"), required: false });
    expect((await login(staff.email)).status).toBe(200);
  });

  it("SP メタデータと未知の識別子の開始はリダイレクトでエラーを返す", async () => {
    const meta = await app.request("/api/v1/auth/sso/metadata");
    expect(meta.status).toBe(200);
    expect(await meta.text()).toContain("EntityDescriptor");
    const start = await app.request("/api/v1/auth/sso/unknown-slug/start");
    expect(start.status).toBe(302);
    expect(start.headers.get("location")).toContain("/login?error=sso");
  });
});
