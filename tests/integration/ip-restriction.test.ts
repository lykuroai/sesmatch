// IP アドレス制限（PRO版仕様書 §4.12, §13）の統合テスト。専用DB sesmatch_test に対して実行する。
// 接続元 IP は X-Forwarded-For（信頼段数 1 = 右端）で決まる
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { makeCompany, setPlan, truncateAll } from "./helpers";
import { setIpAllowList, unlockIpRestrictionByOperations } from "@/server/auth/security";
import { createSession, resolveSession } from "@/server/auth/session";
import { issueApiToken } from "@/server/auth/api-token";
import { hashPassword } from "@/server/auth/password";
import { app } from "@/server/api/app";

const sent: { to: string; subject: string }[] = [];
vi.mock("@/server/mail", () => ({
  appBaseUrl: () => "http://test.local",
  sendMail: async (m: { to: string; subject: string }) => {
    sent.push(m);
  },
}));

beforeEach(async () => {
  await truncateAll();
  sent.length = 0;
  delete process.env.TRUSTED_PROXY_HOPS;
});

const from = (ip: string, cookie?: string) => ({
  headers: { "X-Forwarded-For": ip, ...(cookie ? { Cookie: `sesmatch_session=${cookie}` } : {}) },
});

describe("IP 制限の設定", () => {
  it("基本版では空以外を保存できず、PRO は設定者の IP を含む場合のみ保存できる", async () => {
    const free = await makeCompany("制限なし株式会社");
    expect(await setIpAllowList(free, ["203.0.113.0/24"], "203.0.113.5")).toMatchObject({ error: { code: "PLAN_REQUIRED" } });
    const pro = await setPlan(free, "PRO");
    // 自分の IP を含まないリストは保存できない（ロックアウト防止）
    expect(await setIpAllowList(pro, ["198.51.100.0/24"], "203.0.113.5")).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(await setIpAllowList(pro, ["bad"], "203.0.113.5")).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    const ok = await setIpAllowList(pro, ["203.0.113.0/24", "198.51.100.7"], "203.0.113.5");
    expect(ok).toMatchObject({ ok: true, allowList: ["203.0.113.0/24", "198.51.100.7"] });
    const log = await prisma.auditEvent.findFirst({ where: { tenantCompanyId: pro.companyId, action: "IpAllowListChanged" } });
    expect(log?.metadata).toMatchObject({ count: 2 });
    // 解除（空）はどの IP からでも可
    expect(await setIpAllowList(pro, [], "9.9.9.9")).toMatchObject({ ok: true, allowList: [] });
  });

  it("許可外からの API・ログイン・API トークンは 403 IP_NOT_ALLOWED。ログアウトは可", async () => {
    const owner = await setPlan(await makeCompany("制限あり株式会社"), "PRO");
    await prisma.userAccount.update({ where: { id: owner.userAccountId }, data: { passwordHash: await hashPassword("password123") } });
    await setIpAllowList(owner, ["203.0.113.0/24"], "203.0.113.5");
    const { token: session } = await createSession(owner.userAccountId);
    const auth = await resolveSession(session);
    expect(auth?.ipAllowList).toEqual(["203.0.113.0/24"]);

    // 既存セッション: 許可内は OK、許可外は拒否
    expect((await app.request("/api/v1/company/plan", from("203.0.113.77", session))).status).toBe(200);
    const blocked = await app.request("/api/v1/company/plan", from("198.51.100.1", session));
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error.code).toBe("IP_NOT_ALLOWED");
    // 偽装（左側に追加）しても右端で判定する
    expect((await app.request("/api/v1/company/plan", from("203.0.113.5, 198.51.100.1", session))).status).toBe(403);
    // ログアウトは許可外からでもできる
    expect((await app.request("/api/v1/auth/logout", { method: "POST", ...from("198.51.100.1", session) })).status).toBe(200);

    // ログイン
    const login = (ip: string) =>
      app.request("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
        body: JSON.stringify({ email: owner.email, password: "password123" }),
      });
    expect((await login("203.0.113.9")).status).toBe(200);
    const deniedLogin = await login("198.51.100.1");
    expect(deniedLogin.status).toBe(403);
    expect((await deniedLogin.json()).error.code).toBe("IP_NOT_ALLOWED");
    expect(await prisma.auditEvent.count({ where: { tenantCompanyId: owner.companyId, action: "LoginBlockedByIp" } })).toBe(1);

    // API トークンにも適用
    const issued = await issueApiToken(owner, { name: "連携", scope: "ingest", expiresInDays: 30 });
    if ("error" in issued) throw new Error("token");
    const bearer = (ip: string) => ({ headers: { Authorization: `Bearer ${issued.token}`, "X-Forwarded-For": ip } });
    expect((await app.request("/api/v1/company/plan", bearer("203.0.113.9"))).status).toBe(200);
    expect((await app.request("/api/v1/company/plan", bearer("198.51.100.1"))).status).toBe(403);
  });

  it("信頼段数 2（ALB + nginx）では右端から2番目がクライアント", async () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    const owner = await setPlan(await makeCompany("二段株式会社"), "PRO");
    await setIpAllowList(owner, ["203.0.113.5"], "203.0.113.5");
    const { token: session } = await createSession(owner.userAccountId);
    expect((await app.request("/api/v1/company/plan", from("203.0.113.5, 10.0.0.1", session))).status).toBe(200);
    expect((await app.request("/api/v1/company/plan", from("198.51.100.1, 10.0.0.1", session))).status).toBe(403);
  });

  it("PRO でなくなれば制限は効かない。運営の解除は監査に残り代表へメールする", async () => {
    const owner = await setPlan(await makeCompany("期限切れ株式会社"), "PRO");
    await setIpAllowList(owner, ["203.0.113.5"], "203.0.113.5");
    const { token: session } = await createSession(owner.userAccountId);
    expect((await app.request("/api/v1/company/plan", from("198.51.100.1", session))).status).toBe(403);
    await setPlan(owner, "PRO", new Date(Date.now() - 1000)); // 期限切れ → FREE 扱い
    expect((await app.request("/api/v1/company/plan", from("198.51.100.1", session))).status).toBe(200);
    await setPlan(owner, "PRO");
    expect((await app.request("/api/v1/company/plan", from("198.51.100.1", session))).status).toBe(403);

    // 運営の緊急解除
    process.env.PLATFORM_ADMIN_TOKEN = "admin-test-token";
    const res = await app.request(`/api/v1/operations/companies/${owner.companyId}/security/unlock`, { method: "PUT", headers: { "X-Admin-Token": "admin-test-token" } });
    expect(res.status).toBe(200);
    expect((await app.request("/api/v1/company/plan", from("198.51.100.1", session))).status).toBe(200);
    expect(await prisma.auditEvent.count({ where: { tenantCompanyId: owner.companyId, action: "IpRestrictionUnlockedByOperations" } })).toBe(1);
    expect(sent.some((m) => m.to === owner.email && m.subject.includes("解除"))).toBe(true);
    // 設定なしの解除は 409
    expect(await unlockIpRestrictionByOperations(owner.companyId)).toMatchObject({ error: { code: "VERSION_CONFLICT" } });
  });
});
