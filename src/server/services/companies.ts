// 企業申込・審査・担当者管理（§6.4, §7）

import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import { hashPassword } from "@/server/auth/password";
import type { AuthContext } from "@/server/auth/session";
import { randomBytes } from "crypto";

// 企業申込（§6.4: 申込 → 事業者情報確認 → 規約同意 → 運営審査 → 開通）
export async function applyCompany(input: {
  companyName: string;
  companyType: "CORPORATION" | "SOLE_PROPRIETOR";
  corporateNumber?: string;
  ownerName: string;
  email: string;
  password: string;
  agreedToTerms: boolean;
}) {
  if (!input.agreedToTerms)
    return { error: { code: "VALIDATION_ERROR" as const, message: "規約・基本契約への同意が必要です" } };
  // 法人は法人番号必須（§6.4: 法人番号または事業者情報確認）
  if (input.companyType === "CORPORATION" && !/^\d{13}$/.test(input.corporateNumber ?? ""))
    return { error: { code: "VALIDATION_ERROR" as const, message: "法人番号（13桁）を入力してください" } };

  const existing = await prisma.userAccount.findUnique({ where: { email: input.email } });
  if (existing)
    return { error: { code: "DUPLICATE_ENTRY" as const, message: "このメールアドレスは登録済みです" } };

  const passwordHash = await hashPassword(input.password);
  const company = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        name: input.companyName,
        companyType: input.companyType,
        corporateNumber: input.corporateNumber,
        status: "APPLIED", // 運営審査待ち
      },
    });
    const account = await tx.userAccount.create({
      data: { email: input.email, passwordHash, name: input.ownerName },
    });
    const member = await tx.companyMember.create({
      data: { companyId: company.id, userAccountId: account.id },
    });
    await tx.companyMemberRole.create({ data: { memberId: member.id, role: "OWNER" } });
    return company;
  });
  await audit({
    tenantCompanyId: company.id,
    action: "CompanyApplied",
    targetType: "Company",
    targetId: company.id,
    metadata: { companyType: input.companyType },
  });
  return { companyId: company.id };
}

// 運営審査: 承認して企業コンソールを開通する（運営トークンで保護）
export async function approveCompany(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return { error: { code: "NOT_FOUND" as const } };
  if (company.status !== "APPLIED")
    return { error: { code: "VERSION_CONFLICT" as const, message: "審査待ちの企業ではありません" } };
  await prisma.company.update({ where: { id: companyId }, data: { status: "ACTIVE" } });
  await audit({
    tenantCompanyId: companyId,
    action: "CompanyApproved",
    targetType: "Company",
    targetId: companyId,
  });
  return { ok: true as const };
}

export async function listPendingCompanies() {
  return prisma.company.findMany({
    where: { status: "APPLIED" },
    orderBy: { createdAt: "asc" },
  });
}

const ASSIGNABLE_ROLES = [
  "ADMIN",
  "SALES",
  "HR_MANAGER",
  "PROJECT_MANAGER",
  "CONTRACT",
  "ACCOUNTING",
  "PRIVACY_OFFICER",
  "AUDITOR",
  "VIEWER",
] as const;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

// 担当者招待（§6.4, §28: /company/members/invitations）
// MVP はメール送信の代わりに初期パスワードを一度だけ返す。
export async function inviteMember(
  auth: AuthContext,
  input: { email: string; name: string; roles: string[] }
) {
  const roles = input.roles.filter((r): r is AssignableRole =>
    (ASSIGNABLE_ROLES as readonly string[]).includes(r)
  );
  if (roles.length === 0)
    return { error: { code: "VALIDATION_ERROR" as const, message: "ロールを1つ以上選択してください（オーナーは招待できません）" } };
  const existing = await prisma.userAccount.findUnique({ where: { email: input.email } });
  if (existing)
    return { error: { code: "DUPLICATE_ENTRY" as const, message: "このメールアドレスは登録済みです" } };

  const initialPassword = randomBytes(9).toString("base64url");
  const passwordHash = await hashPassword(initialPassword);
  const member = await prisma.$transaction(async (tx) => {
    const account = await tx.userAccount.create({
      data: { email: input.email, passwordHash, name: input.name },
    });
    const member = await tx.companyMember.create({
      data: { companyId: auth.companyId, userAccountId: account.id },
    });
    await tx.companyMemberRole.createMany({
      data: roles.map((role) => ({ memberId: member.id, role })),
    });
    return member;
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "MemberInvited",
    targetType: "CompanyMember",
    targetId: member.id,
    metadata: { roles },
  });
  return { memberId: member.id, initialPassword };
}

// ロール変更（§7.2）。オーナーロールの付与・剥奪はこのAPIでは行わない。
export async function updateMemberRoles(
  auth: AuthContext,
  memberId: string,
  roles: string[]
) {
  const member = await prisma.companyMember.findFirst({
    where: { id: memberId, companyId: auth.companyId }, // テナント分離
    include: { roles: true },
  });
  if (!member) return { error: { code: "NOT_FOUND" as const } };
  if (member.roles.some((r) => r.role === "OWNER"))
    return { error: { code: "FORBIDDEN" as const, message: "企業オーナーのロールは変更できません" } };

  const nextRoles = roles.filter((r): r is AssignableRole =>
    (ASSIGNABLE_ROLES as readonly string[]).includes(r)
  );
  if (nextRoles.length === 0)
    return { error: { code: "VALIDATION_ERROR" as const, message: "ロールを1つ以上指定してください" } };

  await prisma.$transaction([
    prisma.companyMemberRole.deleteMany({ where: { memberId } }),
    prisma.companyMemberRole.createMany({
      data: nextRoles.map((role) => ({ memberId, role })),
    }),
  ]);
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "MemberRolesUpdated",
    targetType: "CompanyMember",
    targetId: memberId,
    metadata: { roles: nextRoles },
  });
  return { ok: true as const };
}

// 退職・停止（§7.6 の一部: ログイン停止 + セッション失効）
export async function suspendMember(auth: AuthContext, memberId: string) {
  const member = await prisma.companyMember.findFirst({
    where: { id: memberId, companyId: auth.companyId },
    include: { roles: true },
  });
  if (!member) return { error: { code: "NOT_FOUND" as const } };
  if (member.roles.some((r) => r.role === "OWNER"))
    return { error: { code: "FORBIDDEN" as const, message: "企業オーナーは停止できません" } };
  if (member.id === auth.memberId)
    return { error: { code: "FORBIDDEN" as const, message: "自分自身は停止できません" } };

  await prisma.$transaction([
    prisma.companyMember.update({ where: { id: memberId }, data: { status: "RETIRED" } }),
    prisma.session.deleteMany({ where: { userAccountId: member.userAccountId } }), // 全端末ログアウト
  ]);
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "MemberSuspended",
    targetType: "CompanyMember",
    targetId: memberId,
  });
  return { ok: true as const };
}
