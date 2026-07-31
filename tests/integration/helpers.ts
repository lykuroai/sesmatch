// 統合テスト用フィクスチャ
import { prisma } from "@/server/db";
import type { AuthContext } from "@/server/auth/session";

export async function truncateAll() {
  // 安全ガード: 実際の接続先DB名を確認し、テストDB以外なら即座に中断する
  const [{ current_database }] = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
    "SELECT current_database()"
  );
  if (!current_database.endsWith("_test")) {
    throw new Error(
      `FATAL: テストがテストDB以外（${current_database}）に接続しています。TRUNCATE を中止しました`
    );
  }
  // 追記型監査を含め全テーブルを初期化（テストDB専用）
  const tables = [
    "audit_events",
    "reports",
    "prospect_contacts",
    "company_relationships",
    "privacy_requests",
    "invoices",
    "platform_fees",
    "work_months",
    "contracts",
    "interviews",
    "entry_messages",
    "disclosures",
    "entries",
    "matching_results",
    "pii_token_maps",
    "extraction_results",
    "ingestion_jobs",
    "source_documents",
    "person_consents",
    "engineer_skills",
    "engineers",
    "project_skills",
    "projects",
    "sessions",
    "company_member_roles",
    "company_members",
    "user_accounts",
    "companies",
  ];
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`);
}

let seq = 0;

// 企業 + オーナーアカウントを作成し、指定ロールの AuthContext を返す
export async function makeCompany(name: string, roles: string[] = ["OWNER"]): Promise<AuthContext> {
  seq++;
  const company = await prisma.company.create({
    data: { name, companyType: "CORPORATION", status: "ACTIVE" },
  });
  const account = await prisma.userAccount.create({
    data: { email: `user${seq}-${Date.now()}@test.example`, passwordHash: "x", name: `担当者${seq}` },
  });
  const member = await prisma.companyMember.create({
    data: { companyId: company.id, userAccountId: account.id },
  });
  await prisma.companyMemberRole.createMany({
    data: roles.map((role) => ({ memberId: member.id, role: role as never })),
  });
  return {
    userAccountId: account.id,
    userName: account.name,
    email: account.email,
    memberId: member.id,
    companyId: company.id,
    companyName: company.name,
    roles,
  };
}

// 同一企業に別ロールの担当者を追加した AuthContext
export async function addMemberWithRoles(base: AuthContext, roles: string[]): Promise<AuthContext> {
  seq++;
  const account = await prisma.userAccount.create({
    data: { email: `user${seq}-${Date.now()}@test.example`, passwordHash: "x", name: `担当者${seq}` },
  });
  const member = await prisma.companyMember.create({
    data: { companyId: base.companyId, userAccountId: account.id },
  });
  await prisma.companyMemberRole.createMany({
    data: roles.map((role) => ({ memberId: member.id, role: role as never })),
  });
  return { ...base, userAccountId: account.id, memberId: member.id, roles };
}

export const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000);
export const iso = (d: Date) => d.toISOString().slice(0, 10);
