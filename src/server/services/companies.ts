// 企業申込・審査・担当者管理（§6.4, §7）

import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import { hashPassword } from "@/server/auth/password";
import type { AuthContext } from "@/server/auth/session";
import { randomBytes } from "crypto";
import { sendMail, appBaseUrl } from "@/server/mail";
import { checkCompanyDuplicate } from "@/server/pipeline/llm-company-check";
import { judgeCompanyDuplicate, registryJurisdiction } from "@/server/services/company-duplicate";

// 企業IDから現在の企業名を引くマップ（社名変更を表示へ即時反映するため。開示スナップショットの代替表示に使う）
export async function companyNameMap(ids: string[]): Promise<Map<string, string>> {
  const companies = await prisma.company.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, name: true },
  });
  return new Map(companies.map((c) => [c.id, c.name]));
}

// 代表メールの検証コード送付（企業申込 §6.4）。15分有効の6桁コードをメールで送る
export async function sendEmailVerificationCode(email: string) {
  const existing = await prisma.userAccount.findUnique({ where: { email } });
  if (existing)
    return { error: { code: "DUPLICATE_ENTRY" as const, message: "このメールアドレスは登録済みです" } };
  const code = String(randomBytes(4).readUInt32BE() % 900000 + 100000); // 6桁（暗号学的乱数）
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await prisma.emailVerification.upsert({
    where: { email },
    create: { email, code, expiresAt },
    update: { code, expiresAt },
  });
  await sendMail({
    to: email,
    subject: "【SES DirectMatch】メールアドレス確認コード",
    body: `企業申込のメールアドレス確認コードです。

確認コード: ${code}

15分以内に申込画面へ入力してください。
このメールに心当たりがない場合は破棄してください。`,
  });
  return { ok: true as const };
}

// 企業申込（§6.4: 申込 → 事業者情報確認 → 規約同意 → 運営審査 → 開通）
export async function applyCompany(input: {
  companyName: string;
  companyType: "CORPORATION" | "SOLE_PROPRIETOR";
  corporateNumber?: string;
  address: string; // 必須。都道府県から入力（管轄法務局の重複判定に使用）
  ownerName: string;
  email: string;
  password: string;
  agreedToTerms: boolean;
  emailVerificationCode: string;
  duplicateWarningConfirmed?: boolean; // 警告画面で「別企業として申込む」を確認済み
}) {
  if (!input.agreedToTerms)
    return { error: { code: "VALIDATION_ERROR" as const, message: "規約・基本契約への同意が必要です" } };
  // 代表メールの検証（確認コード）
  const verification = await prisma.emailVerification.findUnique({
    where: { email: input.email },
  });
  if (
    !verification ||
    verification.code !== input.emailVerificationCode.trim() ||
    verification.expiresAt < new Date()
  )
    return {
      error: {
        code: "VALIDATION_ERROR" as const,
        message: "メール確認コードが正しくないか期限切れです。コードを再送して入力し直してください",
      },
    };
  // 法人番号は任意入力。指定時のみ形式を検査（§6.4 の事業者情報確認は運営審査で行う）
  if (input.corporateNumber && !/^\d{13}$/.test(input.corporateNumber))
    return { error: { code: "VALIDATION_ERROR" as const, message: "法人番号は13桁で入力してください" } };
  // 所在地は必須。管轄法務局（都道府県）の重複判定に使うため、都道府県からの入力を求める
  const address = input.address.trim();
  if (!address)
    return { error: { code: "VALIDATION_ERROR" as const, message: "所在地を入力してください" } };
  if (!registryJurisdiction(address))
    return {
      error: {
        code: "VALIDATION_ERROR" as const,
        message: "所在地は都道府県から入力してください（例: 東京都台東区上野1-1-1）",
      },
    };

  const existing = await prisma.userAccount.findUnique({ where: { email: input.email } });
  if (existing)
    return { error: { code: "DUPLICATE_ENTRY" as const, message: "このメールアドレスは登録済みです" } };

  // ---- 企業の重複チェック ----
  // 正規化名＋管轄法務局が一致 → NG / 片方のみ一致 → 警告（確認の上で続行可）
  const allCompanies = await prisma.company.findMany({
    select: { name: true, address: true, corporateNumber: true },
  });
  // ① 法人番号の完全一致（決定的）
  if (
    input.corporateNumber &&
    allCompanies.some((c) => c.corporateNumber === input.corporateNumber)
  )
    return {
      error: {
        code: "DUPLICATE_ENTRY" as const,
        message:
          "この法人番号の企業は既に登録されています。担当者として参加する場合は既存企業の代表から招待を受けてください",
      },
    };
  // ② 正規化した企業名・所在地（管轄法務局）による決定的判定
  const judgement = judgeCompanyDuplicate(
    { name: input.companyName, address },
    allCompanies
  );
  if (judgement.level === "ng") {
    await audit({
      action: "CompanyDuplicateDetected",
      targetType: "Company",
      metadata: { matchedName: judgement.matchedName, method: "deterministic" },
    });
    return {
      error: {
        code: "DUPLICATE_ENTRY" as const,
        message: `同一管轄（都道府県）内に同名の企業（${judgement.matchedName}）が既に登録されています。担当者として参加する場合は既存企業の代表から招待を受けてください（別企業の場合は運営へお問い合わせください）`,
      },
    };
  }
  if (judgement.level === "warning" && !input.duplicateWarningConfirmed) {
    return {
      duplicateWarning: {
        matchedName: judgement.matchedName ?? "",
        matchedField: judgement.matchedField ?? "name",
      },
    };
  }
  // ③ LLM による表記ゆれ・同一企業判定（名称＋所在地。障害時はスキップ）。
  // 検出時も即ブロックせず警告扱い（誤判定の可能性があるため申込者の確認で続行可）
  if (!input.duplicateWarningConfirmed) {
    const llmCheck = await checkCompanyDuplicate(
      { name: input.companyName, address },
      allCompanies
    );
    if (llmCheck?.duplicate) {
      await audit({
        action: "CompanyDuplicateDetected",
        targetType: "Company",
        metadata: { matchedName: llmCheck.matchedName, reason: llmCheck.reason.slice(0, 200), method: "llm" },
      });
      return {
        duplicateWarning: {
          matchedName: llmCheck.matchedName ?? "",
          matchedField: "name" as const,
        },
      };
    }
  }

  const passwordHash = await hashPassword(input.password);
  const company = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        name: input.companyName,
        companyType: input.companyType,
        corporateNumber: input.corporateNumber,
        address,
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
    await tx.emailVerification.delete({ where: { email: input.email } }); // 使用済みコードを破棄
    return company;
  });
  await audit({
    tenantCompanyId: company.id,
    action: "CompanyApplied",
    targetType: "Company",
    targetId: company.id,
    metadata: {
      companyType: input.companyType,
      // 重複警告を確認済みで申込んだ場合は運営審査で注意できるよう記録する
      duplicateWarningConfirmed: input.duplicateWarningConfirmed === true,
    },
  });
  await sendMail({
    to: input.email,
    subject: "【SES DirectMatch】企業登録の申込を受け付けました",
    body: `${input.ownerName} 様

${input.companyName} の企業登録申込を受け付けました。
運営による審査ののち、結果をメールでお知らせします。
審査完了までログインはできません。しばらくお待ちください。`,
  });
  return { companyId: company.id };
}

// 運営審査: 承認して企業コンソールを開通する（運営トークンで保護）。
// 申込フロー（本人がパスワード設定済み）のオーナーへ承認通知メールを送る。
// パスワード未発行（CSV取込由来）の担当者へは、承認時の初期パスワード自動発行は行わない。
// 開通後、運営が担当者ごとに「初期パスワード再発行（再招待）」で個別に発行する。
export async function approveCompany(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return { error: { code: "NOT_FOUND" as const } };
  if (company.status !== "APPLIED")
    return { error: { code: "VERSION_CONFLICT" as const, message: "審査待ちの企業ではありません" } };
  // approvedAt は新規企業30日間手数料無料の起点（§23 キャンペーン）
  await prisma.company.update({
    where: { id: companyId },
    data: { status: "ACTIVE", approvedAt: new Date() },
  });
  await audit({
    tenantCompanyId: companyId,
    action: "CompanyApproved",
    targetType: "Company",
    targetId: companyId,
  });
  // 申込フロー（本人がパスワード設定済み）はオーナーへの承認通知のみ
  const owner = await prisma.companyMember.findFirst({
    where: { companyId, roles: { some: { role: "OWNER" } } },
    include: { userAccount: true },
  });
  if (owner) {
    await sendMail({
      to: owner.userAccount.email,
      subject: "【SES DirectMatch】企業登録が承認されました",
      body: `${owner.userAccount.name} 様

${company.name} の企業登録が承認され、利用を開始できるようになりました。
以下の URL から申込時のメールアドレスとパスワードでログインしてください。

${appBaseUrl()}/login`,
    });
  }
  return { ok: true as const };
}

export async function listPendingCompanies() {
  // 審査に必要な詳細（所在地・申込担当者の氏名/メール/ロール）を含めて返す
  const companies = await prisma.company.findMany({
    where: { status: "APPLIED" },
    orderBy: { createdAt: "asc" },
    include: { members: { include: { userAccount: true, roles: true } } },
  });
  return companies.map((c) => ({
    id: c.id,
    name: c.name,
    companyType: c.companyType,
    corporateNumber: c.corporateNumber,
    address: c.address,
    createdAt: c.createdAt,
    members: c.members.map((m) => ({
      name: m.userAccount.name,
      email: m.userAccount.email,
      roles: m.roles.map((r) => r.role),
    })),
  }));
}

// 運営審査: 却下。申込者へ通知メールを送り、申込データ（企業・担当者・アカウント）を削除する
export async function rejectCompany(companyId: string, reason?: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: { members: { include: { userAccount: true } } },
  });
  if (!company) return { error: { code: "NOT_FOUND" as const } };
  if (company.status !== "APPLIED")
    return { error: { code: "VERSION_CONFLICT" as const, message: "審査待ちの企業ではありません" } };

  const recipients = company.members.map((m) => ({
    email: m.userAccount.email,
    name: m.userAccount.name,
  }));
  // 監査ログは削除前に記録（PII は含めない）
  await audit({
    tenantCompanyId: companyId,
    action: "CompanyRejected",
    targetType: "Company",
    targetId: companyId,
    metadata: { reason: (reason ?? "").slice(0, 200) },
  });
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
  for (const r of recipients) {
    await sendMail({
      to: r.email,
      subject: "【SES DirectMatch】企業登録審査の結果について",
      body: `${r.name} 様

${company.name} の企業登録につきまして、審査の結果、今回はご登録を見送らせていただくことになりました。${reason ? `

理由: ${reason}` : ""}

ご不明な点は運営までお問い合わせください。`,
    });
  }
  return { ok: true as const };
}

// 運営: 全企業の一覧（企業修正画面用）
export async function listAllCompanies() {
  return prisma.company.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
    include: { _count: { select: { members: true } } },
  });
}

// 運営: 企業情報の修正（取込した不完全データの補完。企業情報の全項目を修正できる）
export async function updateCompanyByOperations(
  companyId: string,
  input: {
    name: string;
    companyType: "CORPORATION" | "SOLE_PROPRIETOR";
    corporateNumber?: string;
    address?: string;
    dispatchLicenseNumber?: string;
    dispatchLicenseExpiry?: string;
    dispatchManagerName?: string;
  }
) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return { error: { code: "NOT_FOUND" as const } };
  const corporateNumber = (input.corporateNumber ?? "").replace(/\D/g, "");
  if (corporateNumber && !/^\d{13}$/.test(corporateNumber))
    return { error: { code: "VALIDATION_ERROR" as const, message: "法人番号は13桁で入力してください" } };
  // 派遣許可情報の検査は企業側の修正（updateOwnCompany）と同じルール
  const dispatchLicenseNumber = input.dispatchLicenseNumber?.trim() || null;
  const dispatchLicenseExpiry = input.dispatchLicenseExpiry
    ? new Date(input.dispatchLicenseExpiry)
    : null;
  if (dispatchLicenseNumber && !dispatchLicenseExpiry)
    return {
      error: {
        code: "VALIDATION_ERROR" as const,
        message: "労働者派遣事業許可番号を登録する場合は許可有効期限も入力してください",
      },
    };
  if (dispatchLicenseExpiry && isNaN(dispatchLicenseExpiry.getTime()))
    return { error: { code: "VALIDATION_ERROR" as const, message: "許可有効期限の日付が不正です" } };
  await prisma.company.update({
    where: { id: companyId },
    data: {
      name: input.name,
      companyType: input.companyType,
      corporateNumber: corporateNumber || null,
      address: input.address?.trim() || null,
      dispatchLicenseNumber,
      dispatchLicenseExpiry,
      dispatchManagerName: input.dispatchManagerName?.trim() || null,
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

// 企業情報の修正（企業オーナー・企業管理者）。名称・種別・法人番号・所在地・派遣許可情報を自社分のみ変更できる
export async function updateOwnCompany(
  auth: AuthContext,
  input: {
    name: string;
    companyType: "CORPORATION" | "SOLE_PROPRIETOR";
    corporateNumber?: string;
    address?: string;
    dispatchLicenseNumber?: string;
    dispatchLicenseExpiry?: string;
    dispatchManagerName?: string;
  }
) {
  const corporateNumber = (input.corporateNumber ?? "").replace(/\D/g, "");
  // 法人番号は任意入力。指定時のみ形式を検査
  if (corporateNumber && !/^\d{13}$/.test(corporateNumber))
    return { error: { code: "VALIDATION_ERROR" as const, message: "法人番号は13桁で入力してください" } };
  // 派遣許可情報は任意入力だが、番号を登録する場合は有効期限も必須（労働者派遣案件への提案時に有効性を検査）
  const dispatchLicenseNumber = input.dispatchLicenseNumber?.trim() || null;
  const dispatchLicenseExpiry = input.dispatchLicenseExpiry
    ? new Date(input.dispatchLicenseExpiry)
    : null;
  if (dispatchLicenseNumber && !dispatchLicenseExpiry)
    return {
      error: {
        code: "VALIDATION_ERROR" as const,
        message: "労働者派遣事業許可番号を登録する場合は許可有効期限も入力してください",
      },
    };
  if (dispatchLicenseExpiry && isNaN(dispatchLicenseExpiry.getTime()))
    return { error: { code: "VALIDATION_ERROR" as const, message: "許可有効期限の日付が不正です" } };
  await prisma.company.update({
    where: { id: auth.companyId }, // 自社のみ（テナント分離）
    data: {
      name: input.name,
      companyType: input.companyType,
      corporateNumber: corporateNumber || null,
      address: input.address?.trim() || null,
      dispatchLicenseNumber,
      dispatchLicenseExpiry,
      dispatchManagerName: input.dispatchManagerName?.trim() || null,
    },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "CompanyProfileUpdated",
    targetType: "Company",
    targetId: auth.companyId,
    metadata: { companyType: input.companyType },
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

// 運営: 担当者をオーナーに昇格（既存ロールは維持して OWNER を追加）。
// 取込企業は初期ロールが企業管理者のみでオーナー不在のため、運営がここで指名する
export async function promoteMemberToOwnerByOperations(memberId: string) {
  const member = await prisma.companyMember.findUnique({
    where: { id: memberId },
    include: { roles: true },
  });
  if (!member) return { error: { code: "NOT_FOUND" as const } };
  if (member.roles.some((r) => r.role === "OWNER"))
    return { error: { code: "VERSION_CONFLICT" as const, message: "既に代表です" } };
  await prisma.companyMemberRole.create({ data: { memberId, role: "OWNER" } });
  await audit({
    tenantCompanyId: member.companyId,
    action: "MemberPromotedToOwnerByOperations",
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
    subject: "【SES DirectMatch】メンバー招待のお知らせ",
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
    // （同一 CSV 内で同じ企業の担当者が複数行あるケース）。取込担当者は全員企業管理者（ADMIN）権限。
    // 取込時点ではパスワードを発行しない。開通後、運営が担当者ごとの「再招待」で初期パスワードを発行する
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
          await tx.companyMemberRole.create({
            data: { memberId: member.id, role: "ADMIN" },
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
        await tx.companyMemberRole.create({
          data: { memberId: member.id, role: "ADMIN" },
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

// 運営: 全担当者の一覧（メール配信の宛先選択用）
export async function listAllMembersByOperations() {
  const members = await prisma.companyMember.findMany({
    include: { userAccount: true, company: true },
    orderBy: [{ company: { name: "asc" } }, { createdAt: "asc" }],
    take: 5000,
  });
  return {
    items: members.map((m) => ({
      id: m.id,
      name: m.userAccount.name,
      email: m.userAccount.email,
      status: m.status,
      companyId: m.companyId,
      companyName: m.company.name,
      companyStatus: m.company.status,
    })),
  };
}

// 運営: 販促先リスト（CSV）の取込。企業CSVと同じフォーマット（3列/5列）を受け付け、
// 企業名・担当者名・メールアドレスを配信先として保存する（テナント登録はしない）。
// 登録済みメールアドレスの行はエラーにせずスキップする（冪等）
export async function importProspects(rows: CompanyImportRow[]) {
  const results: {
    row: number;
    companyName: string;
    ok: boolean;
    skipped?: boolean;
    message?: string;
  }[] = [];
  let created = 0;
  for (const [i, row] of rows.entries()) {
    const rowNo = i + 1;
    if (!row.companyName || !row.ownerName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      results.push({
        row: rowNo,
        companyName: row.companyName,
        ok: false,
        message: "企業名・担当者名・メールアドレスは必須です",
      });
      continue;
    }
    const existing = await prisma.prospectContact.findUnique({ where: { email: row.email } });
    if (existing) {
      results.push({
        row: rowNo,
        companyName: row.companyName,
        ok: true,
        skipped: true,
        message: "スキップ: このメールアドレスは登録済みです",
      });
      continue;
    }
    await prisma.prospectContact.create({
      data: { companyName: row.companyName, contactName: row.ownerName, email: row.email },
    });
    created++;
    results.push({ row: rowNo, companyName: row.companyName, ok: true });
  }
  await audit({
    action: "ProspectsImported",
    targetType: "ProspectContact",
    metadata: { rows: rows.length, created },
  });
  return { created, results };
}

// 運営: 販促先の一覧（メール配信の宛先選択用）
export async function listProspects() {
  const items = await prisma.prospectContact.findMany({
    orderBy: [{ companyName: "asc" }, { createdAt: "asc" }],
    take: 5000,
  });
  return { items };
}

// 運営: 販促先の削除
export async function deleteProspect(id: string) {
  const prospect = await prisma.prospectContact.findUnique({ where: { id } });
  if (!prospect) return { error: { code: "NOT_FOUND" as const } };
  await prisma.prospectContact.delete({ where: { id } });
  await audit({
    action: "ProspectDeleted",
    targetType: "ProspectContact",
    targetId: id,
  });
  return { ok: true as const };
}

// 運営: 選択した担当者・販促先への一斉メール配信（営業PR・お知らせ）。
// 実行は運営者の明示操作を前提とする。同一メールアドレスへの重複配信は除外。
// 監査ログには件名・件数のみ記録し、宛先の氏名・メールアドレス（PII）は含めない。
export async function sendBroadcastMailByOperations(input: {
  memberIds?: string[];
  prospectIds?: string[];
  subject: string;
  body: string;
}) {
  const memberIds = [...new Set(input.memberIds ?? [])];
  const prospectIds = [...new Set(input.prospectIds ?? [])];
  const requested = memberIds.length + prospectIds.length;
  if (requested === 0)
    return { error: { code: "VALIDATION_ERROR" as const, message: "宛先を選択してください" } };
  const members = memberIds.length
    ? await prisma.companyMember.findMany({
        where: { id: { in: memberIds } },
        include: { userAccount: true },
      })
    : [];
  const prospects = prospectIds.length
    ? await prisma.prospectContact.findMany({ where: { id: { in: prospectIds } } })
    : [];
  const recipients = [
    ...members.map((m) => m.userAccount.email),
    ...prospects.map((p) => p.email),
  ];
  if (recipients.length === 0)
    return { error: { code: "NOT_FOUND" as const, message: "宛先が見つかりません" } };
  const seen = new Set<string>();
  let sent = 0;
  for (const email of recipients) {
    if (seen.has(email)) continue;
    seen.add(email);
    await sendMail({ to: email, subject: input.subject, body: input.body });
    sent++;
  }
  await audit({
    action: "OperationsBroadcastMailSent",
    targetType: "CompanyMember",
    metadata: {
      subject: input.subject,
      requested,
      sent,
      prospects: prospects.length,
    },
  });
  return { sent, notFound: requested - members.length - prospects.length };
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
    return { error: { code: "VALIDATION_ERROR" as const, message: "ロールを1つ以上選択してください（代表は招待できません）" } };
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
    subject: "【SES DirectMatch】メンバー招待のお知らせ",
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
    return { error: { code: "FORBIDDEN" as const, message: "代表のロールは変更できません" } };

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
    return { error: { code: "FORBIDDEN" as const, message: "代表は停止できません" } };
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
    return { error: { code: "FORBIDDEN" as const, message: "代表の情報は変更できません" } };
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
    return { error: { code: "FORBIDDEN" as const, message: "代表は再招待できません" } };
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
    subject: "【SES DirectMatch】メンバー招待のお知らせ（再送）",
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
    return { error: { code: "FORBIDDEN" as const, message: "代表は削除できません" } };
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
