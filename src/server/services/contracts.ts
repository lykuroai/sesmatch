// 契約・稼働・手数料（§22, §23）

import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/auth/session";
import { decideFee, isWithinRefundWindow } from "@/server/billing/fee";
import type { Contract, PlatformFee, WorkMonth } from "@prisma/client";

type Err = { error: { code: string; message?: string } };

function sideOfContract(c: { demandCompanyId: string; supplyCompanyId: string }, companyId: string) {
  if (c.demandCompanyId === companyId) return "DEMAND" as const;
  if (c.supplyCompanyId === companyId) return "SUPPLY" as const;
  return null;
}

const CONTRACT_INCLUDE = {
  entry: { include: { disclosure: true, project: true, engineer: true } },
  workMonths: { include: { fee: true }, orderBy: { month: "asc" as const } },
};

type ContractWithRels = Contract & {
  entry: {
    disclosure: { payload: unknown } | null;
    project: { code: string; name: string };
    engineer: { code: string; name: string };
  };
  workMonths: (WorkMonth & { fee: PlatformFee | null })[];
};

export function serializeContract(c: ContractWithRels, auth: AuthContext) {
  const side = sideOfContract(c, auth.companyId);
  if (!side) return null;
  const payload = (c.entry.disclosure?.payload ?? {}) as Record<string, unknown>;
  return {
    id: c.id,
    entryId: c.entryId,
    side,
    status: c.status,
    contractType: c.contractType,
    monthlyRateYen: c.monthlyRateYen,
    startDate: c.startDate,
    endDate: c.endDate,
    commandChecklist: c.commandChecklist as Record<string, string>,
    notes: c.notes,
    supplySigned: c.supplySignedAt != null,
    demandSigned: c.demandSignedAt != null,
    workStartedAt: c.workStartedAt,
    terminatedAt: c.terminatedAt,
    terminationReason: c.terminationReason,
    // 契約段階は Level 3（§10）: 双方に企業名・氏名を表示
    projectCode: c.entry.project.code,
    projectName: c.entry.project.name,
    engineerCode: c.entry.engineer.code,
    engineerName: c.entry.engineer.name,
    demandCompanyName: (payload.demandCompanyName as string) ?? "",
    supplyCompanyName: (payload.supplyCompanyName as string) ?? "",
    workMonths: c.workMonths.map((wm) => ({
      id: wm.id,
      month: wm.month,
      confirmedAmountYen: wm.confirmedAmountYen,
      fee: wm.fee
        ? {
            feeExTaxYen: wm.fee.feeExTaxYen,
            chargeableMonthIndex: wm.fee.chargeableMonthIndex,
            status: wm.fee.status,
          }
        : null,
    })),
    createdAt: c.createdAt,
  };
}

export async function listContracts(auth: AuthContext) {
  const contracts = await prisma.contract.findMany({
    where: { OR: [{ demandCompanyId: auth.companyId }, { supplyCompanyId: auth.companyId }] },
    include: CONTRACT_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return contracts.map((c) => serializeContract(c, auth)).filter(Boolean);
}

export async function getContract(auth: AuthContext, id: string) {
  const c = await prisma.contract.findUnique({ where: { id }, include: CONTRACT_INCLUDE });
  if (!c) return null;
  return serializeContract(c, auth);
}

const CONTRACTABLE_ENTRY_STATUSES = ["MUTUALLY_APPROVED", "INTERVIEW", "CONDITIONS"];

// 個別契約の作成（§22）。エントリーは双方承認済み（開示済み）であること。
export async function createContract(
  auth: AuthContext,
  input: {
    entryId: string;
    contractType: string;
    monthlyRateYen: number;
    startDate: string;
    endDate?: string;
    commandChecklist: Record<string, string>;
    notes?: string;
  }
): Promise<Err | { contract: NonNullable<ReturnType<typeof serializeContract>> }> {
  const entry = await prisma.entry.findUnique({
    where: { id: input.entryId },
    include: { disclosure: true, contract: true },
  });
  if (!entry || !sideOfContract(entry, auth.companyId))
    return { error: { code: "NOT_FOUND" } };
  if (!entry.disclosure)
    return { error: { code: "VALIDATION_ERROR", message: "双方承認（Level 2 開示）前は契約を作成できません" } };
  if (entry.contract)
    return { error: { code: "DUPLICATE_ENTRY", message: "このエントリーには既に契約があります" } };
  if (!CONTRACTABLE_ENTRY_STATUSES.includes(entry.status))
    return { error: { code: "VERSION_CONFLICT", message: "この状態のエントリーからは契約を作成できません" } };

  // 準委任・請負では指揮命令系統の確認が必須（§22）
  const required = ["instructionManager", "attendanceManager", "assignmentDecider", "acceptanceMethod", "resubcontractApproval"];
  for (const key of required) {
    if (!input.commandChecklist[key]?.trim())
      return { error: { code: "VALIDATION_ERROR", message: "指揮命令・検収等の確認事項をすべて入力してください（§22）" } };
  }

  const [contract] = await prisma.$transaction([
    prisma.contract.create({
      data: {
        entryId: entry.id,
        projectId: entry.projectId,
        engineerId: entry.engineerId,
        demandCompanyId: entry.demandCompanyId,
        supplyCompanyId: entry.supplyCompanyId,
        contractType: input.contractType,
        monthlyRateYen: input.monthlyRateYen,
        startDate: new Date(input.startDate),
        endDate: input.endDate ? new Date(input.endDate) : null,
        commandChecklist: input.commandChecklist,
        notes: input.notes?.trim() ?? "",
        createdByCompanyId: auth.companyId,
      },
      include: CONTRACT_INCLUDE,
    }),
    prisma.entry.update({ where: { id: entry.id }, data: { status: "CONTRACTING" } }),
  ]);
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "ContractCreated",
    targetType: "Contract",
    targetId: contract.id,
  });
  return { contract: serializeContract(contract, auth)! };
}

// 署名（§22）: 相互締結が完了した時点で成約（EXECUTED）。エントリーは CONTRACTED へ。
export async function signContract(auth: AuthContext, contractId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const c = await tx.contract.findUnique({ where: { id: contractId } });
    if (!c) return { error: { code: "NOT_FOUND" as const } };
    const side = sideOfContract(c, auth.companyId);
    if (!side) return { error: { code: "NOT_FOUND" as const } };
    if (!["DRAFT", "SIGNED_SUPPLY", "SIGNED_DEMAND"].includes(c.status))
      return { error: { code: "VERSION_CONFLICT" as const, message: "署名可能な状態ではありません" } };
    const field = side === "SUPPLY" ? "supplySignedAt" : "demandSignedAt";
    if (side === "SUPPLY" ? c.supplySignedAt : c.demandSignedAt)
      return { error: { code: "VERSION_CONFLICT" as const, message: "既に署名済みです" } };

    const other = side === "SUPPLY" ? c.demandSignedAt : c.supplySignedAt;
    const nextStatus = other ? "EXECUTED" : side === "SUPPLY" ? "SIGNED_SUPPLY" : "SIGNED_DEMAND";
    const updated = await tx.contract.updateMany({
      where: { id: contractId, [field]: null, status: c.status },
      data: {
        [field]: new Date(),
        [side === "SUPPLY" ? "supplySignedBy" : "demandSignedBy"]: auth.memberId,
        status: nextStatus,
      },
    });
    if (updated.count !== 1)
      return { error: { code: "VERSION_CONFLICT" as const, message: "同時更新が発生しました" } };
    if (nextStatus === "EXECUTED") {
      await tx.entry.update({ where: { id: c.entryId }, data: { status: "CONTRACTED" } });
      // 成約に合わせて案件の進行状態を自動更新（手動で上書き可能）
      await tx.project.updateMany({
        where: { id: c.projectId },
        data: { workflowStatus: "CONTRACTED" },
      });
    }
    return { ok: true as const, executed: nextStatus === "EXECUTED" };
  });
  if ("error" in result) return result;
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: result.executed ? "ContractExecuted" : "ContractSigned",
    targetType: "Contract",
    targetId: contractId,
  });
  return result;
}

// 実稼働開始（課金起点 §22, §23）
export async function startWork(auth: AuthContext, contractId: string, date: string) {
  const c = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!c || !sideOfContract(c, auth.companyId)) return { error: { code: "NOT_FOUND" as const } };
  if (c.status !== "EXECUTED")
    return { error: { code: "VERSION_CONFLICT" as const, message: "相互締結完了後に稼働開始できます" } };
  await prisma.$transaction([
    prisma.contract.update({
      where: { id: contractId },
      data: { status: "ACTIVE", workStartedAt: new Date(date) },
    }),
    // 稼働開始に合わせて人材の稼働状態を自動更新（手動で上書き可能）
    prisma.engineer.updateMany({ where: { id: c.engineerId }, data: { workStatus: "WORKING" } }),
  ]);
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "WorkStarted",
    targetType: "Contract",
    targetId: contractId,
  });
  return { ok: true as const };
}

// 稼働前キャンセル: 手数料0円（§23）
export async function cancelContract(auth: AuthContext, contractId: string) {
  const c = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!c || !sideOfContract(c, auth.companyId)) return { error: { code: "NOT_FOUND" as const } };
  if (c.workStartedAt)
    return { error: { code: "VERSION_CONFLICT" as const, message: "稼働開始後はキャンセルできません（終了を使用してください）" } };
  if (["CANCELLED", "TERMINATED", "COMPLETED"].includes(c.status))
    return { error: { code: "VERSION_CONFLICT" as const, message: "既に終了しています" } };
  await prisma.contract.update({ where: { id: contractId }, data: { status: "CANCELLED" } });
  // この案件に他の有効な契約がなければ進行状態を応募中へ戻す
  const otherContracts = await prisma.contract.count({
    where: { projectId: c.projectId, status: { in: ["EXECUTED", "ACTIVE"] } },
  });
  if (otherContracts === 0) {
    await prisma.project.updateMany({
      where: { id: c.projectId, workflowStatus: "CONTRACTED" },
      data: { workflowStatus: "RECRUITING" },
    });
  }
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "ContractCancelled",
    targetType: "Contract",
    targetId: contractId,
    metadata: { fee: 0 }, // 稼働前キャンセルは0円
  });
  return { ok: true as const };
}

// 終了。開始後14日以内の離脱は徴収済み手数料を全額返金（§23）
export async function terminateContract(
  auth: AuthContext,
  contractId: string,
  input: { date: string; reason?: string }
) {
  const c = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!c || !sideOfContract(c, auth.companyId)) return { error: { code: "NOT_FOUND" as const } };
  if (c.status !== "ACTIVE" || !c.workStartedAt)
    return { error: { code: "VERSION_CONFLICT" as const, message: "稼働中の契約のみ終了できます" } };

  const terminatedAt = new Date(input.date);
  const refund = isWithinRefundWindow(c.workStartedAt, terminatedAt);

  const refundedCount = await prisma.$transaction(async (tx) => {
    await tx.contract.update({
      where: { id: contractId },
      data: { status: "TERMINATED", terminatedAt, terminationReason: input.reason },
    });
    // 他に稼働中の契約がなければ人材の稼働状態を紹介中へ戻す
    const otherActive = await tx.contract.count({
      where: { engineerId: c.engineerId, status: "ACTIVE" },
    });
    if (otherActive === 0) {
      await tx.engineer.updateMany({
        where: { id: c.engineerId, workStatus: "WORKING" },
        data: { workStatus: "PROPOSING" },
      });
    }
    if (!refund) return 0;
    const updated = await tx.platformFee.updateMany({
      where: { contractId, status: "CHARGED" },
      data: { status: "REFUNDED" },
    });
    return updated.count;
  });

  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "ContractTerminated",
    targetType: "Contract",
    targetId: contractId,
    metadata: { refund, refundedFees: refundedCount },
  });
  if (refund && refundedCount > 0) {
    await audit({
      tenantCompanyId: c.demandCompanyId,
      actorUserId: auth.userAccountId,
      action: "FeeRefunded",
      targetType: "Contract",
      targetId: contractId,
      metadata: { reason: "開始後14日以内の離脱", refundedFees: refundedCount },
    });
  }
  return { ok: true as const, refund, refundedFees: refundedCount };
}

// 月次稼働確認 + 手数料計算（§23）。需要側企業のみ実行できる（手数料負担企業 §6.3）。
export async function confirmWorkMonth(
  auth: AuthContext,
  contractId: string,
  input: { month: string; amountYen: number }
) {
  const c = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!c || !sideOfContract(c, auth.companyId)) return { error: { code: "NOT_FOUND" as const } };
  if (sideOfContract(c, auth.companyId) !== "DEMAND")
    return { error: { code: "FORBIDDEN" as const, message: "月次確認は需要側企業が行います" } };
  if (c.status !== "ACTIVE")
    return { error: { code: "VERSION_CONFLICT" as const, message: "稼働中の契約のみ月次確認できます" } };
  if (!/^\d{4}-\d{2}$/.test(input.month))
    return { error: { code: "VALIDATION_ERROR" as const, message: "対象月は YYYY-MM 形式で指定してください" } };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const wm = await tx.workMonth.create({
        data: {
          contractId,
          month: input.month,
          confirmedAmountYen: input.amountYen,
          confirmedByMemberId: auth.memberId,
        },
      });
      // 12か月上限: (案件, 人材, 需要側企業) の組合せで、契約を跨いで課金済み月数を数える（§23）
      const priorCharged = await tx.platformFee.count({
        where: {
          projectId: c.projectId,
          engineerId: c.engineerId,
          demandCompanyId: c.demandCompanyId,
          status: "CHARGED",
        },
      });
      const decision = decideFee(input.amountYen, priorCharged);
      const fee = await tx.platformFee.create({
        data: {
          workMonthId: wm.id,
          contractId,
          demandCompanyId: c.demandCompanyId,
          projectId: c.projectId,
          engineerId: c.engineerId,
          month: input.month,
          baseAmountYen: input.amountYen,
          feeExTaxYen: decision.feeExTaxYen,
          chargeableMonthIndex: decision.chargeableMonthIndex,
          status: decision.status,
        },
      });
      return { wm, fee };
    });
    await audit({
      tenantCompanyId: auth.companyId,
      actorUserId: auth.userAccountId,
      action: "WorkMonthConfirmed",
      targetType: "Contract",
      targetId: contractId,
      metadata: { month: input.month },
    });
    await audit({
      tenantCompanyId: auth.companyId,
      actorUserId: auth.userAccountId,
      action: "FeeCalculated",
      targetType: "PlatformFee",
      targetId: result.fee.id,
      metadata: {
        month: input.month,
        feeExTaxYen: result.fee.feeExTaxYen,
        index: result.fee.chargeableMonthIndex,
        status: result.fee.status,
      },
    });
    return { workMonth: result.wm, fee: result.fee };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002")
      return { error: { code: "DUPLICATE_ENTRY" as const, message: "この月は確認済みです" } };
    throw e;
  }
}
