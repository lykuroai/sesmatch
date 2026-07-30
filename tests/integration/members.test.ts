// 担当者の修正・削除・再招待（§6.4, §7）の統合テスト
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import {
  deleteMember,
  reinviteMember,
  updateMemberProfile,
} from "@/server/services/companies";
import { verifyPassword } from "@/server/auth/password";
import { addMemberWithRoles, futureDate, makeCompany, truncateAll } from "./helpers";

beforeEach(async () => {
  await truncateAll();
});

describe("updateMemberProfile", () => {
  it("氏名・メールアドレスを変更できる", async () => {
    const owner = await makeCompany("A社");
    const target = await addMemberWithRoles(owner, ["SALES"]);
    const r = await updateMemberProfile(owner, target.memberId, {
      name: "新氏名",
      email: "new-email@test.example",
    });
    expect(r).toEqual({ ok: true });
    const account = await prisma.userAccount.findUnique({ where: { id: target.userAccountId } });
    expect(account?.name).toBe("新氏名");
    expect(account?.email).toBe("new-email@test.example");
  });

  it("登録済みメールアドレスへの変更は拒否する", async () => {
    const owner = await makeCompany("A社");
    const target = await addMemberWithRoles(owner, ["SALES"]);
    const r = await updateMemberProfile(owner, target.memberId, {
      name: target.userName,
      email: owner.email, // オーナーの既存メール
    });
    expect("error" in r && r.error.code).toBe("DUPLICATE_ENTRY");
  });

  it("オーナーは変更できない", async () => {
    const owner = await makeCompany("A社");
    const r = await updateMemberProfile(owner, owner.memberId, {
      name: "x",
      email: "x@test.example",
    });
    expect("error" in r && r.error.code).toBe("FORBIDDEN");
  });

  it("他テナントの担当者は 404（存在推測防止）", async () => {
    const ownerA = await makeCompany("A社");
    const targetA = await addMemberWithRoles(ownerA, ["SALES"]);
    const ownerB = await makeCompany("B社");
    const r = await updateMemberProfile(ownerB, targetA.memberId, {
      name: "x",
      email: "x@test.example",
    });
    expect("error" in r && r.error.code).toBe("NOT_FOUND");
  });
});

describe("reinviteMember", () => {
  it("初期パスワードを再発行し、旧セッションを失効させ、停止中なら有効に戻す", async () => {
    const owner = await makeCompany("A社");
    const target = await addMemberWithRoles(owner, ["SALES"]);
    await prisma.companyMember.update({
      where: { id: target.memberId },
      data: { status: "RETIRED" },
    });
    await prisma.session.create({
      data: { token: "t-old", userAccountId: target.userAccountId, expiresAt: futureDate(1) },
    });
    const before = await prisma.userAccount.findUniqueOrThrow({
      where: { id: target.userAccountId },
    });

    const r = await reinviteMember(owner, target.memberId);
    if ("error" in r) throw new Error(`reinvite failed: ${r.error.code}`);
    expect(r.initialPassword).toBeTruthy();

    const after = await prisma.userAccount.findUniqueOrThrow({ where: { id: target.userAccountId } });
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(await verifyPassword(r.initialPassword, after.passwordHash)).toBe(true);
    const member = await prisma.companyMember.findUniqueOrThrow({ where: { id: target.memberId } });
    expect(member.status).toBe("ACTIVE");
    expect(await prisma.session.count({ where: { userAccountId: target.userAccountId } })).toBe(0);
  });

  it("オーナー・自分自身は再招待できない", async () => {
    const owner = await makeCompany("A社");
    const rOwner = await reinviteMember(owner, owner.memberId);
    expect("error" in rOwner && rOwner.error.code).toBe("FORBIDDEN");
    const target = await addMemberWithRoles(owner, ["ADMIN"]);
    const rSelf = await reinviteMember(target, target.memberId);
    expect("error" in rSelf && rSelf.error.code).toBe("FORBIDDEN");
  });

  it("他テナントの担当者は 404", async () => {
    const ownerA = await makeCompany("A社");
    const targetA = await addMemberWithRoles(ownerA, ["SALES"]);
    const ownerB = await makeCompany("B社");
    const r = await reinviteMember(ownerB, targetA.memberId);
    expect("error" in r && r.error.code).toBe("NOT_FOUND");
  });
});

describe("deleteMember", () => {
  it("担当者・ロール・セッション・アカウントを削除する", async () => {
    const owner = await makeCompany("A社");
    const target = await addMemberWithRoles(owner, ["SALES", "VIEWER"]);
    await prisma.session.create({
      data: { token: "t-del", userAccountId: target.userAccountId, expiresAt: futureDate(1) },
    });

    const r = await deleteMember(owner, target.memberId);
    expect(r).toEqual({ ok: true });
    expect(await prisma.companyMember.findUnique({ where: { id: target.memberId } })).toBeNull();
    expect(await prisma.companyMemberRole.count({ where: { memberId: target.memberId } })).toBe(0);
    expect(await prisma.userAccount.findUnique({ where: { id: target.userAccountId } })).toBeNull();
    expect(await prisma.session.count({ where: { userAccountId: target.userAccountId } })).toBe(0);
  });

  it("オーナー・自分自身は削除できない", async () => {
    const owner = await makeCompany("A社");
    const rOwner = await deleteMember(owner, owner.memberId);
    expect("error" in rOwner && rOwner.error.code).toBe("FORBIDDEN");
    const target = await addMemberWithRoles(owner, ["ADMIN"]);
    const rSelf = await deleteMember(target, target.memberId);
    expect("error" in rSelf && rSelf.error.code).toBe("FORBIDDEN");
  });

  it("他テナントの担当者は 404", async () => {
    const ownerA = await makeCompany("A社");
    const targetA = await addMemberWithRoles(ownerA, ["SALES"]);
    const ownerB = await makeCompany("B社");
    const r = await deleteMember(ownerB, targetA.memberId);
    expect("error" in r && r.error.code).toBe("NOT_FOUND");
  });
});
