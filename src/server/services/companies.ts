// 企業申込・審査・担当者管理（§6.4, §7）

import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import { hashPassword } from "@/server/auth/password";
import type { AuthContext } from "@/server/auth/session";
import { randomBytes } from "crypto";
import { sendMail, appBaseUrl } from "@/server/mail";

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
  await sendMail({
    to: input.email,
    subject: "【SESマッチング】企業登録の申込を受け付けました",
    body: `${input.ownerName} 様

${input.companyName} の企業登録申込を受け付けました。
運営による審査ののち、結果をメールでお知らせします。
審査完了までログインはできません。しばらくお待ちください。`,
  });
  return { companyId: company.id };
}

// 運営審査: 承認して企業コンソールを開通する（運営トークンで保護）。
// パスワード未発行（CSV取込直後）の担当者がいる企業は、承認のこのタイミングで初めて
// 初期パスワードを設定し、初期パスワード付きの招待メールを送る（取込時点では配信しない）。
// initialPassword 指定時は統一パスワード、未指定なら企業ごとに自動生成。
export async function approveCompany(companyId: string, initialPassword?: string) {
  const unified = initialPassword?.trim();
  if (unified && unified.length < 8)
    return {
      error: { code: "VALIDATION_ERROR" as const, message: "初期パスワードは8文字以上にしてください" },
    };
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return { error: { code: "NOT_FOUND" as const } };
  if (company.status !== "APPLIED")
    return { error: { code: "VERSION_CONFLICT" as const, message: "審査待ちの企業ではありません" } };
  const members = await prisma.companyMember.findMany({
    where: { companyId },
    include: { userAccount: true },
  });
  const pending = members.filter((m) => m.userAccount.passwordHash === "");
  await prisma.company.update({ where: { id: companyId }, data: { status: "ACTIVE" } });
  await audit({
    tenantCompanyId: companyId,
    action: "CompanyApproved",
    targetType: "Company",
    targetId: companyId,
    metadata: { invited: pending.length },
  });
  if (pending.length > 0) {
    const password = unified || randomBytes(9).toString("base64url");
    const passwordHash = await hashPassword(password);
    await prisma.userAccount.updateMany({
      where: { id: { in: pending.map((m) => m.userAccountId) } },
      data: { passwordHash },
    });
    for (const m of pending) {
      await sendMail({
        to: m.userAccount.email,
        subject: "【SESマッチング】企業アカウント開設のお知らせ",
        body: `${m.userAccount.name} 様

${company.name} の企業登録が承認され、アカウントが有効になりました。
以下の URL から次の初期パスワードでログインし、パスワードを変更してください。

ログイン: ${appBaseUrl()}/login
メールアドレス: ${m.userAccount.email}
初期パスワード: ${password}`,
      });
    }
    return { ok: true as const, invited: pending.length, initialPassword: password };
  }
  // 申込フロー（本人がパスワード設定済み）はオーナーへの承認通知のみ
  const owner = await prisma.companyMember.findFirst({
    where: { companyId, roles: { some: { role: "OWNER" } } },
    include: { userAccount: true },
  });
  if (owner) {
    await sendMail({
      to: owner.userAccount.email,
      subject: "【SESマッチング】企業登録が承認されました",
      body: `${owner.userAccount.name} 様

${company.name} の企業登録が承認され、利用を開始できるようになりました。
以下の URL から申込時のメールアドレスとパスワードでログインしてください。

${appBaseUrl()}/login`,
    });
  }
  return { ok: true as const };
}

export async function listPendingCompanies() {
  return prisma.company.findMany({
    where: { status: "APPLIED" },
    orderBy: { createdAt: "asc" },
  });
}

// 運営: 全企業の一覧（企業修正画面用）
export async function listAllCompanies() {
  return prisma.company.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
    include: { _count: { select: { members: true } } },
  });
}

// 運営: 企業情報の修正（取込した不完全データの補完。名称・種別・法人番号）
export async function updateCompanyByOperations(
  companyId: string,
  input: { name: string; companyType: "CORPORATION" | "SOLE_PROPRIETOR"; corporateNumber?: string }
) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return { error: { code: "NOT_FOUND" as const } };
  const corporateNumber = (input.corporateNumber ?? "").replace(/\D/g, "");
  if (corporateNumber && !/^\d{13}$/.test(corporateNumber))
    return { error: { code: "VALIDATION_ERROR" as const, message: "法人番号は13桁で入力してください" } };
  await prisma.company.update({
    where: { id: companyId },
    data: {
      name: input.name,
      companyType: input.companyType,
      corporateNumber: corporateNumber || null,
    },
  });
  await audit({
    tenantCompanyId: companyId,
    action: "CompanyUpdatedByOperations",
    targetType: "Company",
    targetId: companyId,
  });
  return { ok: true as const };
}

// 運営: 企業の削除（取込ミス等の是正用）。人材・案件・取込書類などの業務データを持つ企業は
// 削除できない（先にデータ側の整理が必要）。担当者は物理削除し、他企業に所属が残らない
// アカウントはセッションごと削除する。監査ログは追記型のため削除しない。
export async function deleteCompanyByOperations(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return { error: { code: "NOT_FOUND" as const } };
  const [engineers, projects, documents, relationships, reports, privacyRequests] =
    await prisma.$transaction([
      prisma.engineer.count({ where: { tenantCompanyId: companyId } }),
      prisma.project.count({ where: { tenantCompanyId: companyId } }),
      prisma.sourceDocument.count({ where: { tenantCompanyId: companyId } }),
      prisma.companyRelationship.count({ where: { companyId } }),
      prisma.report.count({ where: { tenantCompanyId: companyId } }),
      prisma.privacyRequest.count({ where: { tenantCompanyId: companyId } }),
    ]);
  if (engineers + projects + documents + relationships + reports + privacyRequests > 0)
    return {
      error: {
        code: "VERSION_CONFLICT" as const,
        message: "人材・案件・取込などの業務データがあるため削除できません",
      },
    };
  await prisma.$transaction(async (tx) => {
    const members = await tx.companyMember.findMany({ where: { companyId } });
    await tx.companyMemberRole.deleteMany({
      where: { memberId: { in: members.map((m) => m.id) } },
    });
    await tx.companyMember.deleteMany({ where: { companyId } });
    for (const m of members) {
      const remaining = await tx.companyMember.count({
        where: { userAccountId: m.userAccountId },
      });
      if (remaining === 0) {
        await tx.session.deleteMany({ where: { userAccountId: m.userAccountId } });
        await tx.userAccount.delete({ where: { id: m.userAccountId } });
      }
    }
    await tx.company.delete({ where: { id: companyId } });
  });
  await audit({
    tenantCompanyId: companyId,
    action: "CompanyDeletedByOperations",
    targetType: "Company",
    targetId: companyId,
  });
  return { ok: true as const };
}

// 運営: 企業の担当者一覧（運営コンソールの担当者管理用）
export async function listCompanyMembersByOperations(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return { error: { code: "NOT_FOUND" as const } };
  const members = await prisma.companyMember.findMany({
    where: { companyId },
    include: { userAccount: true, roles: true },
    orderBy: { createdAt: "asc" },
  });
  return {
    items: members.map((m) => ({
      id: m.id,
      name: m.userAccount.name,
      email: m.userAccount.email,
      status: m.status,
      roles: m.roles.map((r) => r.role),
      passwordIssued: m.userAccount.passwordHash !== "", // 初期パスワード配信済みか
    })),
  };
}

// 運営: 担当者の修正（氏名・メールアドレス）。運営権限のためオーナーも修正可
export async function updateMemberByOperations(
  memberId: string,
  input: { name: string; email: string }
) {
  const member = await prisma.companyMember.findUnique({
    where: { id: memberId },
    include: { userAccount: true },
  });
  if (!member) return { error: { code: "NOT_FOUND" as const } };
  if (input.email !== member.userAccount.email) {
    const dup = await prisma.userAccount.findUnique({ where: { email: input.email } });
    if (dup)
      return { error: { code: "DUPLICATE_ENTRY" as const, message: "このメールアドレスは登録済みです" } };
  }
  await prisma.userAccount.update({
    where: { id: member.userAccountId },
    data: { name: input.name, email: input.email },
  });
  await audit({
    tenantCompanyId: member.companyId,
    action: "MemberProfileUpdatedByOperations",
    targetType: "CompanyMember",
    targetId: memberId,
    metadata: { emailChanged: input.email !== member.userAccount.email },
  });
  return { ok: true as const };
}

// 運営: 担当者の削除（オーナーも削除可）。他企業に所属が残らなければアカウントも削除
export async function deleteMemberByOperations(memberId: string) {
  const member = await prisma.companyMember.findUnique({ where: { id: memberId } });
  if (!member) return { error: { code: "NOT_FOUND" as const } };
  await prisma.$transaction(async (tx) => {
    await tx.companyMemberRole.deleteMany({ where: { memberId } });
    await tx.companyMember.delete({ where: { id: memberId } });
    const remaining = await tx.companyMember.count({
      where: { userAccountId: member.userAccountId },
    });
    if (remaining === 0) {
      await tx.session.deleteMany({ where: { userAccountId: member.userAccountId } });
      await tx.userAccount.delete({ where: { id: member.userAccountId } });
    }
  });
  await audit({
    tenantCompanyId: member.companyId,
    action: "MemberDeletedByOperations",
    targetType: "CompanyMember",
    targetId: memberId,
  });
  return { ok: true as const };
}

// 運営: 担当者の再招待（個別に初期パスワードを再発行して招待メールを送る）。
// 旧パスワード・旧セッションは失効し、停止中の担当者は有効に戻す
export async function reinviteMemberByOperations(memberId: string) {
  const member = await prisma.companyMember.findUnique({
    where: { id: memberId },
    include: { userAccount: true, company: true },
  });
  if (!member) return { error: { code: "NOT_FOUND" as const } };
  const initialPassword = randomBytes(9).toString("base64url");
  const passwordHash = await hashPassword(initialPassword);
  await prisma.$transaction([
    prisma.userAccount.update({ where: { id: member.userAccountId }, data: { passwordHash } }),
    prisma.companyMember.update({ where: { id: memberId }, data: { status: "ACTIVE" } }),
    prisma.session.deleteMany({ where: { userAccountId: member.userAccountId } }),
  ]);
  await audit({
    tenantCompanyId: member.companyId,
    action: "MemberReinvitedByOperations",
    targetType: "CompanyMember",
    targetId: memberId,
  });
  await sendMail({
    to: member.userAccount.email,
    subject: "【SESマッチング】メンバー招待のお知らせ",
    body: `${member.userAccount.name} 様

${member.company.name} のメンバーとして招待されました。
以下の URL から次の初期パスワードでログインし、パスワードを変更してください。

ログイン: ${appBaseUrl()}/login
メールアドレス: ${member.userAccount.email}
初期パスワード: ${initialPassword}`,
  });
  return { memberId: member.id, initialPassword };
}

// 運営: 企業リスト（CSV）の一括取込。取込した企業は審査待ち（APPLIED）で登録し、
// 運営が企業審査で承認するまで有効化しない（ログイン不可）。担当者はパスワード未発行
// （passwordHash 空）で作成し、初期パスワードの設定と招待メールの配信は承認時
// （approveCompany）に行う。取込時点ではメールを一切送らない。
// 行単位で成否を返し、失敗行はスキップする。
export type CompanyImportRow = {
  companyName: string;
  companyType: "CORPORATION" | "SOLE_PROPRIETOR";
  corporateNumber?: string;
  ownerName: string;
  email: string;
};

export async function importCompanies(rows: CompanyImportRow[]) {
  const results: {
    row: number;
    companyName: string;
    ok: boolean;
    skipped?: boolean;
    message?: string;
  }[] = [];
  let created = 0; // 新規に開通した企業数（既存企業への担当者追加は含めない）
  for (const [i, row] of rows.entries()) {
    const rowNo = i + 1;
    const fail = (message: string) =>
      results.push({ row: rowNo, companyName: row.companyName, ok: false, message });
    // 重複などの既登録データはエラーにせず読み飛ばす
    const skip = (message: string) =>
      results.push({ row: rowNo, companyName: row.companyName, ok: true, skipped: true, message });

    if (!row.companyName || !row.ownerName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      fail("企業名・担当者名・メールアドレスは必須です");
      continue;
    }
    // 法人番号は任意（不完全なリストを許容し、後から企業修正で補完する）。指定時のみ形式を検査
    if (row.corporateNumber && !/^\d{13}$/.test(row.corporateNumber)) {
      fail("法人番号は13桁で入力してください");
      continue;
    }
    const existing = await prisma.userAccount.findUnique({ where: { email: row.email } });
    if (existing) {
      skip("スキップ: このメールアドレスは登録済みです");
      continue;
    }

    // 同名企業が既にある場合は、新規作成せず既存企業へ担当者として追加する
    // （同一 CSV 内で同じ企業の担当者が複数行あるケース）。取込担当者は全員オーナー・管理者権限。
    // 追加先が審査待ちなら承認時に、承認済みなら再招待で初期パスワードを発行する
    const sameName = await prisma.company.findFirst({ where: { name: row.companyName } });
    if (sameName) {
      try {
        await prisma.$transaction(async (tx) => {
          const account = await tx.userAccount.create({
            data: { email: row.email, passwordHash: "", name: row.ownerName },
          });
          const member = await tx.companyMember.create({
            data: { companyId: sameName.id, userAccountId: account.id },
          });
          await tx.companyMemberRole.createMany({
            data: [
              { memberId: member.id, role: "OWNER" },
              { memberId: member.id, role: "ADMIN" },
            ],
          });
        });
      } catch {
        skip("スキップ: 重複データ");
        continue;
      }
      await audit({
        tenantCompanyId: sameName.id,
        action: "CompanyImportMemberAdded",
        targetType: "Company",
        targetId: sameName.id,
        metadata: { row: rowNo },
      });
      results.push({
        row: rowNo,
        companyName: row.companyName,
        ok: true,
        message: "既存企業に担当者を追加しました",
      });
      continue;
    }

    let company;
    try {
      company = await prisma.$transaction(async (tx) => {
        const company = await tx.company.create({
          data: {
            name: row.companyName,
            companyType: row.companyType,
            corporateNumber: row.corporateNumber || undefined,
            status: "APPLIED", // 運営の承認（企業審査）で開通するまで無効
          },
        });
        const account = await tx.userAccount.create({
          data: { email: row.email, passwordHash: "", name: row.ownerName },
        });
        const member = await tx.companyMember.create({
          data: { companyId: company.id, userAccountId: account.id },
        });
        await tx.companyMemberRole.createMany({
          data: [
            { memberId: member.id, role: "OWNER" },
            { memberId: member.id, role: "ADMIN" },
          ],
        });
        return company;
      });
    } catch {
      // 一意制約違反（同一メールの重複行など）は読み飛ばして継続
      skip("スキップ: 重複データ");
      continue;
    }
    await audit({
      tenantCompanyId: company.id,
      action: "CompanyImported",
      targetType: "Company",
      targetId: company.id,
      metadata: { companyType: row.companyType, row: rowNo },
    });
    created++;
    results.push({ row: rowNo, companyName: row.companyName, ok: true });
  }
  return { created, results };
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
// 初期パスワードは招待メール（SES）で本人に送り、画面にも一度だけ返す。
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
  const company = await prisma.company.findUnique({ where: { id: auth.companyId } });
  await sendMail({
    to: input.email,
    subject: "【SESマッチング】メンバー招待のお知らせ",
    body: `${input.name} 様

${company?.name ?? ""} のメンバーとして招待されました。
以下の URL から次の初期パスワードでログインし、パスワードを変更してください。

ログイン: ${appBaseUrl()}/login
メールアドレス: ${input.email}
初期パスワード: ${initialPassword}`,
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

// 担当者情報の修正（氏名・メールアドレス）。オーナーは対象外。
export async function updateMemberProfile(
  auth: AuthContext,
  memberId: string,
  input: { name: string; email: string }
) {
  const member = await prisma.companyMember.findFirst({
    where: { id: memberId, companyId: auth.companyId }, // テナント分離
    include: { roles: true, userAccount: true },
  });
  if (!member) return { error: { code: "NOT_FOUND" as const } };
  if (member.roles.some((r) => r.role === "OWNER"))
    return { error: { code: "FORBIDDEN" as const, message: "企業オーナーの情報は変更できません" } };
  if (input.email !== member.userAccount.email) {
    const dup = await prisma.userAccount.findUnique({ where: { email: input.email } });
    if (dup)
      return { error: { code: "DUPLICATE_ENTRY" as const, message: "このメールアドレスは登録済みです" } };
  }
  await prisma.userAccount.update({
    where: { id: member.userAccountId },
    data: { name: input.name, email: input.email },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "MemberProfileUpdated",
    targetType: "CompanyMember",
    targetId: memberId,
    metadata: { emailChanged: input.email !== member.userAccount.email }, // 監査ログに PII は含めない
  });
  return { ok: true as const };
}

// 再招待: 初期パスワードを再発行して招待メールを再送する（§6.4）。
// 旧パスワード・旧セッションは失効し、停止（RETIRED）中の担当者は有効に戻す。
export async function reinviteMember(auth: AuthContext, memberId: string) {
  const member = await prisma.companyMember.findFirst({
    where: { id: memberId, companyId: auth.companyId }, // テナント分離
    include: { roles: true, userAccount: true },
  });
  if (!member) return { error: { code: "NOT_FOUND" as const } };
  if (member.roles.some((r) => r.role === "OWNER"))
    return { error: { code: "FORBIDDEN" as const, message: "企業オーナーは再招待できません" } };
  if (member.id === auth.memberId)
    return { error: { code: "FORBIDDEN" as const, message: "自分自身は再招待できません" } };

  const initialPassword = randomBytes(9).toString("base64url");
  const passwordHash = await hashPassword(initialPassword);
  await prisma.$transaction([
    prisma.userAccount.update({ where: { id: member.userAccountId }, data: { passwordHash } }),
    prisma.companyMember.update({ where: { id: memberId }, data: { status: "ACTIVE" } }),
    prisma.session.deleteMany({ where: { userAccountId: member.userAccountId } }), // 全端末ログアウト
  ]);
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "MemberReinvited",
    targetType: "CompanyMember",
    targetId: memberId,
  });
  const company = await prisma.company.findUnique({ where: { id: auth.companyId } });
  await sendMail({
    to: member.userAccount.email,
    subject: "【SESマッチング】メンバー招待のお知らせ（再送）",
    body: `${member.userAccount.name} 様

${company?.name ?? ""} のメンバーとして招待されました。
以下の URL から次の初期パスワードでログインし、パスワードを変更してください。
（以前の招待のパスワードは無効になりました）

ログイン: ${appBaseUrl()}/login
メールアドレス: ${member.userAccount.email}
初期パスワード: ${initialPassword}`,
  });
  return { memberId: member.id, initialPassword };
}

// 担当者の削除（アカウント物理削除）。オーナー・自分自身は削除不可。
export async function deleteMember(auth: AuthContext, memberId: string) {
  const member = await prisma.companyMember.findFirst({
    where: { id: memberId, companyId: auth.companyId }, // テナント分離
    include: { roles: true },
  });
  if (!member) return { error: { code: "NOT_FOUND" as const } };
  if (member.roles.some((r) => r.role === "OWNER"))
    return { error: { code: "FORBIDDEN" as const, message: "企業オーナーは削除できません" } };
  if (member.id === auth.memberId)
    return { error: { code: "FORBIDDEN" as const, message: "自分自身は削除できません" } };

  await prisma.$transaction(async (tx) => {
    await tx.companyMemberRole.deleteMany({ where: { memberId } });
    await tx.companyMember.delete({ where: { id: memberId } });
    // 他企業への所属が残っていない場合のみアカウント本体とセッションを削除
    const remaining = await tx.companyMember.count({
      where: { userAccountId: member.userAccountId },
    });
    if (remaining === 0) {
      await tx.session.deleteMany({ where: { userAccountId: member.userAccountId } });
      await tx.userAccount.delete({ where: { id: member.userAccountId } });
    }
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "MemberDeleted",
    targetType: "CompanyMember",
    targetId: memberId, // 監査ログに氏名・メール等の PII は含めない
  });
  return { ok: true as const };
}
