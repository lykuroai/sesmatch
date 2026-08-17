// APIトークン（PAT §4.1）の統合テスト。
// 発行・Bearer認証・スコープ制限・失効・メンバー無効化による自動失効を検証する
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { issueApiToken, resolveApiToken, revokeApiToken } from "@/server/auth/api-token";
import { app } from "@/server/api/app";
import { addMemberWithRoles, makeCompany, truncateAll } from "./helpers";

beforeEach(async () => {
  await truncateAll();
});

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

describe("APIトークン発行", () => {
  it("発行した平文トークンで認証でき、発行メンバーのAuthContextが得られる", async () => {
    const owner = await makeCompany("PAT-A社");
    const issued = await issueApiToken(owner, { name: "テスト連携", scope: "ingest", expiresInDays: 365 });
    if ("error" in issued) throw new Error("発行に失敗");
    expect(issued.token).toMatch(/^ses_pat_[0-9a-f]{64}$/);

    const resolved = await resolveApiToken(issued.token);
    expect(resolved?.auth.companyId).toBe(owner.companyId);
    expect(resolved?.auth.memberId).toBe(owner.memberId);
    expect(resolved?.tokenPermissions).toEqual(["ingestion.create"]);
    // DBに平文が保存されていないこと
    const row = await prisma.apiToken.findFirstOrThrow();
    expect(row.tokenHash).not.toContain(issued.token);
  });

  it("スコープの権限を持たないメンバーには発行しない", async () => {
    const owner = await makeCompany("PAT-B社");
    const adminAuth = await addMemberWithRoles(owner, ["ADMIN"]); // ADMIN は ingestion.create を持たない
    const r = await issueApiToken(adminAuth, { name: "x", scope: "ingest", expiresInDays: null });
    expect("error" in r && r.error?.code).toBe("FORBIDDEN");
  });
});

describe("Bearer認証とスコープ制限", () => {
  it("ingest スコープ: 取込APIは通り、案件登録・エントリー閲覧はスコープ外で403", async () => {
    const owner = await makeCompany("PAT-C社");
    const issued = await issueApiToken(owner, { name: "取込のみ", scope: "ingest", expiresInDays: 365 });
    if ("error" in issued) throw new Error("発行に失敗");

    const ok = await app.request("/api/v1/ingestions", bearer(issued.token));
    expect(ok.status).toBe(200);

    // オーナー本人は project.create を持つが、トークンのスコープ外なので403
    const denied = await app.request("/api/v1/projects", { method: "POST", ...bearer(issued.token) });
    expect(denied.status).toBe(403);
    const deniedRead = await app.request("/api/v1/entries", bearer(issued.token));
    expect(deniedRead.status).toBe(403);
  });

  it("ingest-register スコープ: 案件登録の権限チェックを通過する（バリデーションまで到達）", async () => {
    const owner = await makeCompany("PAT-D社");
    const issued = await issueApiToken(owner, { name: "登録可", scope: "ingest-register", expiresInDays: 365 });
    if ("error" in issued) throw new Error("発行に失敗");
    const res = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { Authorization: `Bearer ${issued.token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400); // 403（権限・スコープ）ではなく入力バリデーションで止まる
  });

  it("トークンではトークン管理APIを操作できない", async () => {
    const owner = await makeCompany("PAT-E社");
    const issued = await issueApiToken(owner, { name: "x", scope: "ingest-register", expiresInDays: 365 });
    if ("error" in issued) throw new Error("発行に失敗");
    const res = await app.request("/api/v1/api-tokens", bearer(issued.token));
    expect(res.status).toBe(403);
  });
});

describe("失効・自動失効", () => {
  it("失効後は401になる", async () => {
    const owner = await makeCompany("PAT-F社");
    const issued = await issueApiToken(owner, { name: "x", scope: "ingest", expiresInDays: 365 });
    if ("error" in issued) throw new Error("発行に失敗");
    const revoked = await revokeApiToken(owner, issued.item.id);
    expect(revoked).toEqual({ ok: true });
    const res = await app.request("/api/v1/ingestions", bearer(issued.token));
    expect(res.status).toBe(401);
  });

  it("期限切れトークンは401になる", async () => {
    const owner = await makeCompany("PAT-G社");
    const issued = await issueApiToken(owner, { name: "x", scope: "ingest", expiresInDays: -1 });
    if ("error" in issued) throw new Error("発行に失敗");
    expect(await resolveApiToken(issued.token)).toBeNull();
  });

  it("メンバー無効化で自動失効する", async () => {
    const owner = await makeCompany("PAT-H社");
    const issued = await issueApiToken(owner, { name: "x", scope: "ingest", expiresInDays: 365 });
    if ("error" in issued) throw new Error("発行に失敗");
    await prisma.companyMember.update({ where: { id: owner.memberId }, data: { status: "SUSPENDED" } });
    expect(await resolveApiToken(issued.token)).toBeNull();
  });

  it("他人のトークンは member.manage が無いと失効できない", async () => {
    const owner = await makeCompany("PAT-I社");
    const salesAuth = await addMemberWithRoles(owner, ["SALES"]);
    const ownerToken = await issueApiToken(owner, { name: "owner用", scope: "ingest", expiresInDays: 365 });
    if ("error" in ownerToken) throw new Error("発行に失敗");
    const r = await revokeApiToken(salesAuth, ownerToken.item.id);
    expect("error" in r && r.error?.code).toBe("FORBIDDEN");
    // member.manage を持つオーナーは他人（SALES）のトークンを失効できる
    const salesToken = await issueApiToken(salesAuth, { name: "sales用", scope: "ingest", expiresInDays: 365 });
    if ("error" in salesToken) throw new Error("発行に失敗");
    expect(await revokeApiToken(owner, salesToken.item.id)).toEqual({ ok: true });
  });
});
