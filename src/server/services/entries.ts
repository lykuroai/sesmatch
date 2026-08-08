// エントリー・双方承認・段階開示・メッセージ・面談（§20, §21）

import { Prisma, RoleCode } from "@prisma/client";
import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import { hasPermission } from "@/server/auth/rbac";
import { sendMail, appBaseUrl } from "@/server/mail";
import type { AuthContext } from "@/server/auth/session";
import {
  applyApproval,
  canDecline,
  canMoveToConditions,
  canScheduleInterview,
  sideOf,
  type Side,
} from "@/server/entries/logic";
import { detectContactInfo } from "@/server/pipeline/pii";
import { DISPATCH_CONTRACT_TYPE } from "@/lib/constants";
import { hasValidConsent, serializeEngineer } from "./engineers";
import { companyNameMap } from "./companies";
import { serializeProject } from "./projects";

const ENTRY_INCLUDE = {
  project: { include: { skills: true } },
  engineer: { include: { skills: true, consents: true } },
  messages: { orderBy: { createdAt: "asc" as const } },
  interviews: { orderBy: { scheduledAt: "asc" as const } },
  disclosure: true,
  contract: { select: { id: true, status: true } },
};

type EntryWithRels = Prisma.EntryGetPayload<{ include: typeof ENTRY_INCLUDE }>;

// 開示制御付きシリアライズ:
// - 双方承認前: 相手企業名は非開示、人材は Level 1（§10, §20.3）
// - 開示後: Disclosure のスナップショットを双方に同時開示。
//   ただし企業名は社名変更を反映するため常に最新（companyNames）を優先し、スナップショットはフォールバック
export function serializeEntry(
  e: EntryWithRels,
  auth: AuthContext,
  companyNames?: Map<string, string>
) {
  const side = sideOf(e, auth.companyId);
  if (!side) return null; // 当事者以外は 404 相当（§29）
  const disclosed = e.disclosure != null;
  const payload = (e.disclosure?.payload ?? null) as {
    engineerName?: string;
    engineerRateYen?: number;
    demandCompanyName?: string;
    supplyCompanyName?: string;
  } | null;

  return {
    id: e.id,
    type: e.type,
    status: e.status,
    side, // 自社の立場
    createdByOwn: e.createdByCompanyId === auth.companyId,
    note: e.note,
    subtierApproved: e.subtierApproved,
    supplyApproved: e.supplyApprovedAt != null,
    demandApproved: e.demandApprovedAt != null,
    declinedReason: e.declinedReason,
    createdAt: e.createdAt,
    contract: e.contract ? { id: e.contract.id, status: e.contract.status } : null,
    project: serializeProject(e.project, auth),
    engineer: serializeEngineer(e.engineer, auth),
    // ---- Level 2 開示（双方承認後のみ §20.3）----
    disclosure: disclosed
      ? {
          engineerName: payload?.engineerName,
          engineerRateYen: payload?.engineerRateYen,
          demandCompanyName:
            companyNames?.get(e.demandCompanyId) ?? payload?.demandCompanyName,
          supplyCompanyName:
            companyNames?.get(e.supplyCompanyId) ?? payload?.supplyCompanyName,
          disclosedAt: e.disclosure!.createdAt,
        }
      : null,
    counterpartCompanyName: disclosed
      ? side === "DEMAND"
        ? (companyNames?.get(e.supplyCompanyId) ?? payload?.supplyCompanyName)
        : (companyNames?.get(e.demandCompanyId) ?? payload?.demandCompanyName)
      : null, // 承認前は非開示
    messages: e.messages.map((m) => ({
      id: m.id,
      own: m.senderCompanyId === auth.companyId,
      senderName: m.senderName,
      body: m.body,
      createdAt: m.createdAt,
    })),
    interviews: e.interviews.map((iv) => ({
      id: iv.id,
      scheduledAt: iv.scheduledAt,
      method: iv.method,
      note: iv.note,
      status: iv.status,
    })),
  };
}

export async function listEntries(auth: AuthContext) {
  const entries = await prisma.entry.findMany({
    where: {
      OR: [{ demandCompanyId: auth.companyId }, { supplyCompanyId: auth.companyId }],
    },
    include: ENTRY_INCLUDE,
    orderBy: { updatedAt: "desc" },
  });
  const names = await companyNameMap(
    entries.flatMap((e) => [e.demandCompanyId, e.supplyCompanyId])
  );
  return entries.map((e) => serializeEntry(e, auth, names)).filter(Boolean);
}

export async function getEntry(auth: AuthContext, id: string) {
  const e = await prisma.entry.findUnique({ where: { id }, include: ENTRY_INCLUDE });
  if (!e) return null;
  const names = await companyNameMap([e.demandCompanyId, e.supplyCompanyId]);
  return serializeEntry(e, auth, names);
}

// エントリー受信通知: 受信対象（提案=案件、スカウト=人材）の登録者へメール。
// 登録者が空白（既存データ）なら最終更新者、どちらも無効（未記録・退職等）なら
// 受信側企業の entry.approve 権限を持つアクティブ担当者全員へフォールバック。
// 双方承認前のため相手企業名・人材氏名等の Level 2 情報は含めない（§10, §20.3）。
// 通知の失敗はエントリー作成を失敗させない。
async function notifyEntryReceived(
  entry: { id: string; type: string; demandCompanyId: string; supplyCompanyId: string },
  project: { name: string; code: string; createdByMemberId: string | null; updatedByMemberId: string | null },
  engineer: { code: string; createdByMemberId: string | null; updatedByMemberId: string | null }
) {
  try {
    const receivingCompanyId =
      entry.type === "PROPOSAL" ? entry.demandCompanyId : entry.supplyCompanyId;
    const target = entry.type === "PROPOSAL" ? project : engineer;

    let members: Prisma.CompanyMemberGetPayload<{ include: { userAccount: true } }>[] = [];
    for (const memberId of [target.createdByMemberId, target.updatedByMemberId]) {
      if (!memberId) continue;
      members = await prisma.companyMember.findMany({
        where: {
          id: memberId,
          companyId: receivingCompanyId, // 受信側企業に属することを確認
          status: "ACTIVE",
        },
        include: { userAccount: true },
      });
      if (members.length > 0) break;
    }
    if (members.length === 0) {
      const approverRoles = Object.values(RoleCode).filter((role) =>
        hasPermission([role], "entry.approve")
      );
      members = await prisma.companyMember.findMany({
        where: {
          companyId: receivingCompanyId,
          status: "ACTIVE",
          roles: { some: { role: { in: approverRoles } } },
        },
        include: { userAccount: true },
      });
    }
    const detail =
      entry.type === "PROPOSAL"
        ? `貴社案件「${project.name}」（${project.code}）に人材のご提案が届きました。
提案人材コード: ${engineer.code}`
        : `貴社人材（${engineer.code}）へのスカウトが届きました。
対象案件: 「${project.name}」（${project.code}）`;
    await Promise.all(
      members.map((m) =>
        sendMail({
          to: m.userAccount.email,
          subject:
            entry.type === "PROPOSAL"
              ? "【SES DirectMatch】案件へのエントリー（提案）が届きました"
              : "【SES DirectMatch】人材へのスカウトが届きました",
          body: `${m.userAccount.name} 様

${detail}

以下のURLからエントリー内容をご確認ください。
${appBaseUrl()}/entries/${entry.id}`,
        })
      )
    );
  } catch (e) {
    console.error(`[mail] エントリー受信通知の送信に失敗 entryId=${entry.id}`, e);
  }
}

export type CreateEntryInput = {
  type: "PROPOSAL" | "SCOUT";
  projectId: string;
  engineerId: string;
  note?: string;
  subtierApproved?: boolean;
};

export async function createEntry(auth: AuthContext, input: CreateEntryInput) {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    include: { skills: true },
  });
  const engineer = await prisma.engineer.findUnique({
    where: { id: input.engineerId },
    include: { consents: true },
  });
  if (!project || !engineer) return { error: { code: "NOT_FOUND" as const } };

  if (input.type === "PROPOSAL") {
    // 自社人材を他社案件へ提案
    if (engineer.tenantCompanyId !== auth.companyId)
      return { error: { code: "FORBIDDEN" as const, message: "自社管理人材のみ提案できます" } };
    if (project.tenantCompanyId === auth.companyId)
      return { error: { code: "VALIDATION_ERROR" as const, message: "自社案件への提案はできません" } };
    if (project.status !== "PUBLISHED")
      return { error: { code: "NOT_FOUND" as const } };
  } else {
    // 他社人材を自社案件へスカウト
    if (project.tenantCompanyId !== auth.companyId)
      return { error: { code: "FORBIDDEN" as const, message: "自社案件のみスカウトできます" } };
    if (engineer.tenantCompanyId === auth.companyId)
      return { error: { code: "VALIDATION_ERROR" as const, message: "自社人材へのスカウトは不要です" } };
    if (engineer.status !== "PUBLISHED") return { error: { code: "NOT_FOUND" as const } };
  }

  // 公開状態・本人同意（§19.1）
  if (engineer.status !== "PUBLISHED" || !hasValidConsent(engineer.consents))
    return {
      error: { code: "CONSENT_REQUIRED" as const, message: "人材が公開状態でないか、有効な本人同意がありません" },
    };

  // 受入所属区分（§12）
  if (project.acceptedTypes.length > 0 && !project.acceptedTypes.includes(engineer.affiliationType))
    return {
      error: { code: "VALIDATION_ERROR" as const, message: "この案件の受入所属区分の対象外です" },
    };

  // 労働者派遣の案件（基本契約第4条）: 供給側企業の直接雇用（自社社員）のみ提案可。
  // 一社下・再委託先・個人事業主の人材は派遣できない（二重派遣・違法な労働者供給の防止）。
  // 供給側企業には有効な労働者派遣事業許可（番号・有効期限）と派遣元責任者の登録が必須
  if (project.contractType === DISPATCH_CONTRACT_TYPE) {
    if (engineer.affiliationType !== "EMPLOYEE")
      return {
        error: {
          code: "VALIDATION_ERROR" as const,
          message:
            "労働者派遣の案件には供給側企業が直接雇用する人材（自社社員）のみ提案できます（一社下・再委託先等の人材は派遣できません）",
        },
      };
    const supplyCompany = await prisma.company.findUniqueOrThrow({
      where: { id: engineer.tenantCompanyId },
    });
    if (!supplyCompany.dispatchLicenseNumber)
      return {
        error: {
          code: "VALIDATION_ERROR" as const,
          message: "労働者派遣事業許可番号が未登録です（設定 > 企業情報で登録してください）",
        },
      };
    if (!supplyCompany.dispatchLicenseExpiry || supplyCompany.dispatchLicenseExpiry < new Date())
      return {
        error: {
          code: "VALIDATION_ERROR" as const,
          message: "労働者派遣事業許可の有効期限が未登録または期限切れです",
        },
      };
    if (!supplyCompany.dispatchManagerName)
      return {
        error: {
          code: "VALIDATION_ERROR" as const,
          message: "派遣元責任者が未登録です（設定 > 企業情報で登録してください）",
        },
      };
  }

  // 一社下（§12.4）: 案件側の一社下可、直接契約確認済みの一社下関係、案件単位の承認が必須
  if (engineer.affiliationType === "SUBTIER1") {
    if (!project.allowSubtier)
      return { error: { code: "VALIDATION_ERROR" as const, message: "一社下不可の案件です" } };
    const rel = await prisma.companyRelationship.findFirst({
      where: { companyId: engineer.tenantCompanyId, type: "SUBTIER", contractConfirmed: true },
    });
    if (!rel)
      return {
        error: {
          code: "VALIDATION_ERROR" as const,
          message: "直接契約が確認済みの一社下企業関係が登録されていません（企業間関係で登録してください）",
        },
      };
    if (!input.subtierApproved)
      return {
        error: {
          code: "VALIDATION_ERROR" as const,
          message: "案件単位の一社下企業承認が必要です",
        },
      };
  }

  const demandCompanyId = project.tenantCompanyId;
  const supplyCompanyId = engineer.tenantCompanyId;

  try {
    const entry = await prisma.entry.create({
      data: {
        type: input.type,
        // 申請側の承認は提出時に記録（提案=供給側承認、スカウト=需要側承認）
        status: input.type === "PROPOSAL" ? "SUPPLY_APPROVED" : "DEMAND_APPROVED",
        projectId: project.id,
        engineerId: engineer.id,
        demandCompanyId,
        supplyCompanyId,
        createdByCompanyId: auth.companyId,
        createdByMemberId: auth.memberId,
        note: input.note,
        subtierApproved: input.subtierApproved ?? false,
        supplyApprovedAt: input.type === "PROPOSAL" ? new Date() : null,
        demandApprovedAt: input.type === "SCOUT" ? new Date() : null,
      },
      include: ENTRY_INCLUDE,
    });
    await audit({
      tenantCompanyId: auth.companyId,
      actorUserId: auth.userAccountId,
      action: "EntrySubmitted",
      targetType: "Entry",
      targetId: entry.id,
      metadata: { type: input.type, projectId: project.id, engineerId: engineer.id },
    });
    await notifyEntryReceived(entry, project, engineer);
    return {
      entry: serializeEntry(
        entry,
        auth,
        await companyNameMap([entry.demandCompanyId, entry.supplyCompanyId])
      ),
    };
  } catch (e) {
    // 重複応募ブロック（§18）
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return {
        error: { code: "DUPLICATE_ENTRY" as const, message: "同一人材×同一案件のエントリーが既に存在します" },
      };
    throw e;
  }
}

// 双方承認（§20.3）: 承認確認と Level 2 開示レコード作成を同一トランザクションで行う。
// 冪等性: 状態条件付き updateMany で並行承認の二重処理を防ぐ（§34）。
export async function approveEntry(auth: AuthContext, entryId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const entry = await tx.entry.findUnique({ where: { id: entryId } });
    if (!entry) return { error: { code: "NOT_FOUND" as const } };
    const side = sideOf(entry, auth.companyId);
    if (!side) return { error: { code: "NOT_FOUND" as const } }; // 当事者外は404（§29）

    const approval = applyApproval(entry, side);
    if (!approval.ok)
      return {
        error: {
          code: "VERSION_CONFLICT" as const,
          message: approval.error === "ALREADY_APPROVED" ? "既に承認済みです" : "承認可能な状態ではありません",
        },
      };

    // 楽観的条件付き更新: 同時実行時はどちらか一方のみ成功する
    const field = side === "SUPPLY" ? "supplyApprovedAt" : "demandApprovedAt";
    const updated = await tx.entry.updateMany({
      where: { id: entryId, [field]: null, status: entry.status },
      data: { [field]: new Date(), status: approval.nextStatus },
    });
    if (updated.count !== 1)
      return { error: { code: "VERSION_CONFLICT" as const, message: "同時更新が発生しました。再読み込みしてください" } };

    if (approval.mutual) {
      // Level 2 開示スナップショット（相互・同時開示 §10, §20.3）
      const [engineer, demandCompany, supplyCompany] = await Promise.all([
        tx.engineer.findUniqueOrThrow({ where: { id: entry.engineerId } }),
        tx.company.findUniqueOrThrow({ where: { id: entry.demandCompanyId } }),
        tx.company.findUniqueOrThrow({ where: { id: entry.supplyCompanyId } }),
      ]);
      await tx.disclosure.create({
        data: {
          entryId,
          level: 2,
          payload: {
            engineerName: engineer.name,
            engineerRateYen: engineer.desiredRateYen,
            demandCompanyName: demandCompany.name,
            supplyCompanyName: supplyCompany.name,
          },
        },
      });
    }
    return { ok: true as const, mutual: approval.mutual, side };
  });

  if ("error" in result) return result;

  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: result.mutual ? "MutualApprovalCompleted" : "EntryApproved",
    targetType: "Entry",
    targetId: entryId,
    metadata: { side: result.side },
  });
  return result;
}

export async function declineEntry(auth: AuthContext, entryId: string, reason: string | undefined, kind: "DECLINED" | "WITHDRAWN") {
  const entry = await prisma.entry.findUnique({ where: { id: entryId } });
  if (!entry || !sideOf(entry, auth.companyId)) return { error: { code: "NOT_FOUND" as const } };
  if (!canDecline(entry.status))
    return { error: { code: "VERSION_CONFLICT" as const, message: "この状態では操作できません" } };
  // 辞退は申請側、見送りは相手側
  const isCreator = entry.createdByCompanyId === auth.companyId;
  if (kind === "WITHDRAWN" && !isCreator)
    return { error: { code: "FORBIDDEN" as const, message: "辞退は申請側のみ可能です" } };
  if (kind === "DECLINED" && isCreator)
    return { error: { code: "FORBIDDEN" as const, message: "見送りは受信側のみ可能です" } };

  await prisma.entry.update({
    where: { id: entryId },
    data: { status: kind, declinedReason: reason },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: kind === "DECLINED" ? "EntryDeclined" : "EntryWithdrawn",
    targetType: "Entry",
    targetId: entryId,
  });
  return { ok: true as const };
}

// メッセージ送信（§21）: 相互承認前は連絡先を検出した場合、保存せず修正要求＋監査記録
export async function sendMessage(auth: AuthContext, entryId: string, body: string) {
  const entry = await prisma.entry.findUnique({
    where: { id: entryId },
    include: { disclosure: true },
  });
  if (!entry || !sideOf(entry, auth.companyId)) return { error: { code: "NOT_FOUND" as const } };

  if (!entry.disclosure) {
    const findings = detectContactInfo(body);
    if (findings.length > 0) {
      await audit({
        tenantCompanyId: auth.companyId,
        actorUserId: auth.userAccountId,
        action: "ContactInfoBlocked",
        targetType: "Entry",
        targetId: entryId,
        metadata: { kinds: findings },
      });
      return {
        error: {
          code: "PII_VALIDATION_FAILED" as const,
          message: `相互承認前のメッセージに連絡先情報（${findings.join(", ")}）を含めることはできません。修正して再送してください`,
        },
      };
    }
  }

  const message = await prisma.entryMessage.create({
    data: {
      entryId,
      senderCompanyId: auth.companyId,
      senderMemberId: auth.memberId,
      senderName: auth.userName,
      body,
    },
  });
  return { message };
}

// 面談登録（§20.2: 双方承認後のみ）
export async function scheduleInterview(
  auth: AuthContext,
  entryId: string,
  input: { scheduledAt: string; method: string; note?: string }
) {
  const entry = await prisma.entry.findUnique({ where: { id: entryId } });
  if (!entry || !sideOf(entry, auth.companyId)) return { error: { code: "NOT_FOUND" as const } };
  if (!canScheduleInterview(entry.status))
    return { error: { code: "VERSION_CONFLICT" as const, message: "面談は双方承認後に設定できます" } };

  const interview = await prisma.interview.create({
    data: {
      entryId,
      scheduledAt: new Date(input.scheduledAt),
      method: input.method,
      note: input.note,
    },
  });
  if (entry.status === "MUTUALLY_APPROVED") {
    await prisma.entry.update({ where: { id: entryId }, data: { status: "INTERVIEW" } });
  }
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "InterviewConfirmed",
    targetType: "Entry",
    targetId: entryId,
    metadata: { interviewId: interview.id },
  });
  return { interview };
}

// 条件調整へ（面談後）
export async function moveToConditions(auth: AuthContext, entryId: string) {
  const entry = await prisma.entry.findUnique({ where: { id: entryId } });
  if (!entry || !sideOf(entry, auth.companyId)) return { error: { code: "NOT_FOUND" as const } };
  if (!canMoveToConditions(entry.status))
    return { error: { code: "VERSION_CONFLICT" as const, message: "面談中のエントリーのみ条件調整へ進められます" } };
  await prisma.entry.update({ where: { id: entryId }, data: { status: "CONDITIONS" } });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "EntryMovedToConditions",
    targetType: "Entry",
    targetId: entryId,
  });
  return { ok: true as const };
}
