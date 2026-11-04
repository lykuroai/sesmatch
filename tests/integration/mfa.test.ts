// 2要素認証と企業の必須化（PRO版仕様書 §4.11, §13）の統合テスト。専用DB sesmatch_test に対して実行する。
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addMemberWithRoles, makeCompany, setPlan, truncateAll } from "./helpers";
import { beginMfaSetup, disableMfa, enableMfa, getMfaStatus, setMfaRequired, verifyMfaCode, resetMfaByOperations } from "@/server/auth/mfa";
import { totp } from "@/server/auth/totp";
import { resolveSession, createSession } from "@/server/auth/session";
import { hashPassword } from "@/server/auth/password";
import { app } from "@/server/api/app";

beforeEach(async () => {
  await truncateAll();
});

describe("2要素認証", () => {
  it("設定→有効化→ログイン第2段階→バックアップコードは1回だけ→無効化", async () => {
    const owner = await makeCompany("MFA株式会社");
    await prisma.userAccount.update({ where: { id: owner.userAccountId }, data: { passwordHash: await hashPassword("password123") } });
    const setup = await beginMfaSetup(owner);
    if ("error" in setup) throw new Error("setup");
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.qrDataUrl.startsWith("data:image/png")).toBe(true);
    const wrong = await enableMfa(owner, "000000");
    expect("error" in wrong).toBe(true);
    const enabled = await enableMfa(owner, totp(setup.secret));
    if ("error" in enabled) throw new Error(String(enabled.error));
    expect(enabled.backupCodes).toHaveLength(10);
    expect((await getMfaStatus(owner.userAccountId)).enabled).toBe(true);
    // 秘密鍵は平文で保存されていない
    const row = await prisma.userMfa.findUniqueOrThrow({ where: { userAccountId: owner.userAccountId } });
    expect(row.secretEncrypted).not.toContain(setup.secret);

    // ログイン: 第1段階はセッションを作らずチャレンジを返す
    const first = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: owner.email, password: "password123" }),
    });
    expect(first.status).toBe(200);
    const b1 = await first.json();
    expect(b1.mfaRequired).toBe(true);
    expect(first.headers.get("set-cookie")).toBeNull();
    const bad = await app.request("/api/v1/auth/login/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId: b1.challengeId, code: "000000" }),
    });
    expect(bad.status).toBe(401);
    const good = await app.request("/api/v1/auth/login/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId: b1.challengeId, code: totp(setup.secret) }),
    });
    expect(good.status).toBe(200);
    expect(good.headers.get("set-cookie")).toContain("sesmatch_session=");
    // チャレンジは1回で消える
    const reuse = await app.request("/api/v1/auth/login/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId: b1.challengeId, code: totp(setup.secret) }),
    });
    expect(reuse.status).toBe(401);

    // バックアップコードは1回のみ
    const code = enabled.backupCodes[0];
    expect(await verifyMfaCode(owner.userAccountId, code)).toBe(true);
    expect(await verifyMfaCode(owner.userAccountId, code)).toBe(false);
    expect((await getMfaStatus(owner.userAccountId)).backupCodesLeft).toBe(9);

    // 無効化（必須化されていない企業）
    const off = await disableMfa({ ...owner, mfaEnabled: true }, totp(setup.secret));
    expect("ok" in off && off.ok).toBe(true);
    expect((await getMfaStatus(owner.userAccountId)).enabled).toBe(false);
  });

  it("必須化は PRO のみ。自分が未設定なら必須化できず、必須化後の未設定メンバーは API が 403 MFA_REQUIRED", async () => {
    const free = await makeCompany("必須基本版株式会社");
    expect("error" in (await setMfaRequired(free, true)) && (await setMfaRequired(free, true)).error?.code).toBe("PLAN_REQUIRED");
    const pro = await setPlan(await makeCompany("必須PRO株式会社"), "PRO");
    const notYet = await setMfaRequired(pro, true);
    expect("error" in notYet && notYet.error?.code).toBe("VALIDATION_ERROR");
    const setup = await beginMfaSetup(pro);
    if ("error" in setup) throw new Error("setup");
    await enableMfa(pro, totp(setup.secret));
    const ok = await setMfaRequired({ ...pro, mfaEnabled: true }, true);
    expect("ok" in ok && ok.ok).toBe(true);

    // 未設定の営業担当: セッションは作れるが、設定以外の API は 403
    const sales = await addMemberWithRoles(pro, ["SALES"]);
    const { token } = await createSession(sales.userAccountId);
    const ctx = await resolveSession(token);
    expect(ctx?.mfaRequired).toBe(true);
    expect(ctx?.mfaEnabled).toBe(false);
    const cookie = `sesmatch_session=${token}`;
    const blocked = await app.request("/api/v1/projects", { headers: { Cookie: cookie } });
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error.code).toBe("MFA_REQUIRED");
    const allowed = await app.request("/api/v1/auth/mfa", { headers: { Cookie: cookie } });
    expect(allowed.status).toBe(200);
    // 本人は必須化中のため無効化できない
    const ownerCtx = await resolveSession((await createSession(pro.userAccountId)).token);
    const deny = await disableMfa(ownerCtx!, totp(setup.secret));
    expect("error" in deny && deny.error?.code).toBe("FORBIDDEN");
    // 運営リセット後は再設定が必要（必須化のため引き続きブロック）
    const member = await prisma.companyMember.findFirstOrThrow({ where: { userAccountId: pro.userAccountId } });
    await resetMfaByOperations(member.id);
    expect((await getMfaStatus(pro.userAccountId)).enabled).toBe(false);
    // FREE に戻ると必須化は効かない
    await setPlan(pro, "FREE");
    const ctxFree = await resolveSession(token);
    expect(ctxFree?.mfaRequired).toBe(false);
  });
});
