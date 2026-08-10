// 契約・稼働・手数料（§22, §23）

import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/auth/session";
import { decideFee, isWithinRefundWindow } from "@/server/billing/fee";
import { DISPATCH_CONTRACT_TYPE } from "@/lib/constants";
import { Prisma } from "@prisma/client";
import type { Contract, PlatformFee, WorkMonth } from "@prisma/client";
import { companyNameMap } from "./companies";

type Err = { error: { code: string; message?: string } };

function sideOfContract(c: { demandCompanyId: string; supplyCompanyId: string }, companyId: string) {
  if (c.demandCompanyId === companyId) return "DEMAND" as const;
  if (c.supplyCompanyId === companyId) return "SUPPLY" as const;
  return null;
}

// 1人材は同一期間に1件のみ成約できる: 同一人材で契約期間が重複する成約済み
// （EXECUTED/ACTIVE）契約を探す。endDate が null の契約は無期限として扱う
async function findOverlappingExecutedContract(
  db: Prisma.TransactionClient | typeof prisma,
  target: { engineerId: string; startDate: Date; endDate: Date | null; excludeContractId?: string }
) {
  return db.contract.findFirst({
    where: {
      engineerId: target.engineerId,
      ...(target.excludeContractId ? { id: { not: target.excludeContractId } } : {}),
      status: { in: ["EXECUTED", "ACTIVE"] },
      ...(target.endDate ? { startDate: { lte: target.endDate } } : {}),
      OR: [{ endDate: null }, { endDate: { gte: target.startDate } }],
    },
  });
}

const OVERLAP_MESSAGE =
  "この人材には契約期間が重複する成約済みの契約があります（1人材が同一期間に成約できるのは1案件のみです）";

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

// 企業名は社名変更を反映するため常に最新（companyNames）を優先し、開示スナップショットはフォールバック
export function serializeContract(
  c: ContractWithRels,
  auth: AuthContext,
  companyNames?: Map<string, string>
) {
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
    version: c.version,
    updatedAt: c.updatedAt,
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
    demandCompanyName:
      companyNames?.get(c.demandCompanyId) ?? (payload.demandCompanyName as string) ?? "",
    supplyCompanyName:
      companyNames?.get(c.supplyCompanyId) ?? (payload.supplyCompanyName as string) ?? "",
    workMonths: c.workMonths.map((wm) => ({
      id: wm.id,
      month: wm.month,
      confirmedAmountYen: wm.confirmedAmountYen,
      // 手数料は需要側企業の負担（§23）のため、供給側には金額・状態を返さない
      fee:
        side === "DEMAND" && wm.fee
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

// 月次稼働・手数料の自動計算（§23）: 稼働中の契約について、稼働開始月から当月までの
// WorkMonth と手数料を自動生成する。金額は契約の月額（monthlyRateYen）。
// @@unique([contractId, month]) により冪等（並行アクセスでも二重計上しない）。
// 契約詳細・契約一覧・請求画面の表示時に呼ばれる（手動の月次確認ボタンは廃止）
export async function ensureWorkMonths(c: Contract) {
  if (c.status !== "ACTIVE" || !c.workStartedAt) return;
  const now = new Date();
  const months: string[] = [];
  const cur = new Date(Date.UTC(c.workStartedAt.getUTCFullYear(), c.workStartedAt.getUTCMonth(), 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  while (cur <= last) {
    months.push(cur.toISOString().slice(0, 7));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  const existing = await prisma.workMonth.findMany({
    where: { contractId: c.id },
    select: { month: true },
  });
  const have = new Set(existing.map((w) => w.month));
  for (const month of months.filter((m) => !have.has(m))) {
    try {
      await prisma.$transaction(async (tx) => {
        const wm = await tx.workMonth.create({
          data: { contractId: c.id, month, confirmedAmountYen: c.monthlyRateYen },
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
        const decision = decideFee(c.monthlyRateYen, priorCharged);
        await tx.platformFee.create({
          data: {
            workMonthId: wm.id,
            contractId: c.id,
            demandCompanyId: c.demandCompanyId,
            projectId: c.projectId,
            engineerId: c.engineerId,
            month,
            baseAmountYen: c.monthlyRateYen,
            feeExTaxYen: decision.feeExTaxYen,
            chargeableMonthIndex: decision.chargeableMonthIndex,
            status: decision.status,
          },
        });
      });
      await audit({
        tenantCompanyId: c.demandCompanyId,
        action: "WorkMonthAutoCalculated",
        targetType: "Contract",
        targetId: c.id,
        metadata: { month },
      });
    } catch {
      // 一意制約違反（並行実行）は無視して継続
    }
  }
}

export async function listContracts(auth: AuthContext) {
  // 稼働中契約の月次稼働・手数料を最新化してから返す（自動計算）
  const active = await prisma.contract.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ demandCompanyId: auth.companyId }, { supplyCompanyId: auth.companyId }],
    },
  });
  for (const c of active) await ensureWorkMonths(c);
  const contracts = await prisma.contract.findMany({
    where: { OR: [{ demandCompanyId: auth.companyId }, { supplyCompanyId: auth.companyId }] },
    include: CONTRACT_INCLUDE,
    orderBy: { updatedAt: "desc" }, // 直近で動きのあった契約を上に
  });
  const names = await companyNameMap(
    contracts.flatMap((c) => [c.demandCompanyId, c.supplyCompanyId])
  );
  return contracts.map((c) => serializeContract(c, auth, names)).filter(Boolean);
}

export async function getContract(auth: AuthContext, id: string) {
  let c = await prisma.contract.findUnique({ where: { id }, include: CONTRACT_INCLUDE });
  if (!c) return null;
  if (c.status === "ACTIVE") {
    // 表示時に月次稼働・手数料を最新化（自動計算）
    await ensureWorkMonths(c);
    c = await prisma.contract.findUnique({ where: { id }, include: CONTRACT_INCLUDE });
    if (!c) return null;
  }
  return serializeContract(c, auth, await companyNameMap([c.demandCompanyId, c.supplyCompanyId]));
}

const CONTRACTABLE_ENTRY_STATUSES = ["MUTUALLY_APPROVED", "INTERVIEW", "CONDITIONS"];

// 指揮命令・検収等の確認事項（§22）。作成・修正の双方で必須
const CHECKLIST_REQUIRED_KEYS = [
  "instructionManager",
  "attendanceManager",
  "assignmentDecider",
  "acceptanceMethod",
  "resubcontractApproval",
];

function validateChecklist(checklist: Record<string, string>): Err | null {
  for (const key of CHECKLIST_REQUIRED_KEYS) {
    if (!checklist[key]?.trim())
      return { error: { code: "VALIDATION_ERROR", message: "指揮命令・検収等の確認事項をすべて入力してください（§22）" } };
  }
  return null;
}

// 労働者派遣契約（基本契約第4条）: 供給側の派遣事業許可の有効性と直接雇用（自社社員）を確認する。
// 提案時から状況が変わり得るため、契約の作成・修正のたびに再検査する
async function validateDispatchContract(
  contractType: string,
  engineerAffiliationType: string,
  supplyCompanyId: string
): Promise<Err | null> {
  if (contractType !== DISPATCH_CONTRACT_TYPE) return null;
  if (engineerAffiliationType !== "EMPLOYEE")
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: "労働者派遣契約は供給側企業が直接雇用する人材（自社社員）のみ締結できます",
      },
    };
  const supplyCompany = await prisma.company.findUniqueOrThrow({ where: { id: supplyCompanyId } });
  if (
    !supplyCompany.dispatchLicenseNumber ||
    !supplyCompany.dispatchLicenseExpiry ||
    supplyCompany.dispatchLicenseExpiry < new Date()
  )
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: "供給側企業の労働者派遣事業許可（番号・有効期限）が未登録または期限切れです",
      },
    };
  if (!supplyCompany.dispatchManagerName)
    return { error: { code: "VALIDATION_ERROR", message: "供給側企業の派遣元責任者が未登録です" } };
  return null;
}

// 条件確認書の作成（§22）。エントリーは双方承認済み（開示済み）であること。
// 作成・修正は案件提供側（需要側企業）のみ行える。
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
    include: { disclosure: true, contract: true, engineer: true },
  });
  if (!entry || !sideOfContract(entry, auth.companyId))
    return { error: { code: "NOT_FOUND" } };
  if (sideOfContract(entry, auth.companyId) !== "DEMAND")
    return { error: { code: "FORBIDDEN", message: "条件確認書の作成は案件提供側（需要側企業）のみ行えます" } };
  if (!entry.disclosure)
    return { error: { code: "VALIDATION_ERROR", message: "双方承認（Level 2 開示）前は契約を作成できません" } };
  if (entry.contract)
    return { error: { code: "DUPLICATE_ENTRY", message: "このエントリーには既に契約があります" } };
  if (!CONTRACTABLE_ENTRY_STATUSES.includes(entry.status))
    return { error: { code: "VERSION_CONFLICT", message: "この状態のエントリーからは契約を作成できません" } };

  const dispatchError = await validateDispatchContract(
    input.contractType,
    entry.engineer.affiliationType,
    entry.supplyCompanyId
  );
  if (dispatchError) return dispatchError;

  // 準委任・請負では指揮命令系統の確認が必須（§22）
  const checklistError = validateChecklist(input.commandChecklist);
  if (checklistError) return checklistError;

  // 1人材=同一期間1成約（早期チェック。確定判定は署名時に行う）
  const overlapping = await findOverlappingExecutedContract(prisma, {
    engineerId: entry.engineerId,
    startDate: new Date(input.startDate),
    endDate: input.endDate ? new Date(input.endDate) : null,
  });
  if (overlapping) return { error: { code: "VALIDATION_ERROR", message: OVERLAP_MESSAGE } };

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
  return {
    contract: serializeContract(
      contract,
      auth,
      await companyNameMap([contract.demandCompanyId, contract.supplyCompanyId])
    )!,
  };
}

// 署名完了前の条件確認書の修正（§22）: 案件提供側（需要側企業）のみ、相互締結（EXECUTED）前のみ可。修正すると既存の署名は取り消され、
// 双方の再署名が必要になる（変更後の内容に対する署名の有効性を担保）。
// expectedVersion は修正者が編集を開始した時点の版数。相手方が先に修正していた場合は版数不一致で
// 拒否し、他方の修正内容を知らないまま上書きしてしまうことを防ぐ。
// 条件付き updateMany により、並行する署名・修正操作と競合した場合はどちらか一方のみ成功する
export async function updateContract(
  auth: AuthContext,
  contractId: string,
  input: {
    contractType: string;
    monthlyRateYen: number;
    startDate: string;
    endDate?: string;
    commandChecklist: Record<string, string>;
    notes?: string;
    version: number;
  }
): Promise<Err | { contract: NonNullable<ReturnType<typeof serializeContract>> }> {
  const c = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { entry: { include: { engineer: true } } },
  });
  if (!c || !sideOfContract(c, auth.companyId)) return { error: { code: "NOT_FOUND" } };
  if (sideOfContract(c, auth.companyId) !== "DEMAND")
    return { error: { code: "FORBIDDEN", message: "条件確認書の修正は案件提供側（需要側企業）のみ行えます" } };
  if (!["DRAFT", "SIGNED_SUPPLY", "SIGNED_DEMAND"].includes(c.status))
    return { error: { code: "VERSION_CONFLICT", message: "双方署名の完了後（成約以降）は修正できません" } };
  if (c.version !== input.version)
    return {
      error: {
        code: "VERSION_CONFLICT",
        message: "契約内容が他の担当者により修正されています。最新の内容を読み込み直してから修正してください",
      },
    };

  const checklistError = validateChecklist(input.commandChecklist);
  if (checklistError) return checklistError;
  const dispatchError = await validateDispatchContract(
    input.contractType,
    c.entry.engineer.affiliationType,
    c.supplyCompanyId
  );
  if (dispatchError) return dispatchError;

  // 1人材=同一期間1成約（早期チェック。確定判定は署名時に行う）
  const overlapping = await findOverlappingExecutedContract(prisma, {
    engineerId: c.engineerId,
    startDate: new Date(input.startDate),
    endDate: input.endDate ? new Date(input.endDate) : null,
    excludeContractId: c.id,
  });
  if (overlapping) return { error: { code: "VALIDATION_ERROR", message: OVERLAP_MESSAGE } };

  const signaturesReset = c.supplySignedAt != null || c.demandSignedAt != null;
  const updated = await prisma.contract.updateMany({
    where: { id: contractId, status: c.status, version: input.version },
    data: {
      contractType: input.contractType,
      monthlyRateYen: input.monthlyRateYen,
      startDate: new Date(input.startDate),
      endDate: input.endDate ? new Date(input.endDate) : null,
      commandChecklist: input.commandChecklist,
      notes: input.notes?.trim() ?? "",
      version: { increment: 1 }, // 版数を上げ、旧版を見たままの署名を無効化する
      status: "DRAFT",
      supplySignedAt: null,
      supplySignedBy: null,
      demandSignedAt: null,
      demandSignedBy: null,
    },
  });
  if (updated.count !== 1)
    return { error: { code: "VERSION_CONFLICT", message: "同時更新が発生しました。再読み込みしてください" } };

  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "ContractUpdated",
    targetType: "Contract",
    targetId: contractId,
    metadata: { signaturesReset, version: c.version + 1 },
  });
  const fresh = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: CONTRACT_INCLUDE,
  });
  return {
    contract: serializeContract(
      fresh,
      auth,
      await companyNameMap([fresh.demandCompanyId, fresh.supplyCompanyId])
    )!,
  };
}

// 署名（§22）: 相互締結が完了した時点で成約（EXECUTED）。エントリーは CONTRACTED へ。
// expectedVersion は署名者が画面で閲覧していた契約の版数。相手方が先に修正していた場合は
// 版数不一致で拒否し、修正後の内容に気づかないまま署名してしまうことを防ぐ
export async function signContract(auth: AuthContext, contractId: string, expectedVersion: number) {
  // Serializable: 同一人材の別契約が並行して締結された場合も「1人材=同一期間1成約」を保証する
  const result = await prisma
    .$transaction(
      async (tx) => {
        return signContractInTx(tx, auth, contractId, expectedVersion);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
    .catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034")
        return { error: { code: "VERSION_CONFLICT" as const, message: "同時更新が発生しました。再試行してください" } };
      throw e;
    });
  if ("error" in result) return result;
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: result.executed ? "ContractExecuted" : "ContractSigned",
    targetType: "Contract",
    targetId: contractId,
    metadata: { version: expectedVersion },
  });
  return result;
}

async function signContractInTx(
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  contractId: string,
  expectedVersion: number
) {
  const c = await tx.contract.findUnique({ where: { id: contractId } });
  if (!c) return { error: { code: "NOT_FOUND" as const } };
  const side = sideOfContract(c, auth.companyId);
  if (!side) return { error: { code: "NOT_FOUND" as const } };
  if (!["DRAFT", "SIGNED_SUPPLY", "SIGNED_DEMAND"].includes(c.status))
    return { error: { code: "VERSION_CONFLICT" as const, message: "署名可能な状態ではありません" } };
  if (c.version !== expectedVersion)
    return {
      error: {
        code: "VERSION_CONFLICT" as const,
        message: "契約内容が修正されています。最新の内容を確認してから署名してください（再読み込みしてください）",
      },
    };
  const field = side === "SUPPLY" ? "supplySignedAt" : "demandSignedAt";
  if (side === "SUPPLY" ? c.supplySignedAt : c.demandSignedAt)
    return { error: { code: "VERSION_CONFLICT" as const, message: "既に署名済みです" } };

  const other = side === "SUPPLY" ? c.demandSignedAt : c.supplySignedAt;
  const nextStatus = other ? "EXECUTED" : side === "SUPPLY" ? "SIGNED_SUPPLY" : "SIGNED_DEMAND";

  // 1人材=同一期間1成約: 締結（成約確定）の直前に期間重複する成約済み契約がないことを確認する
  if (nextStatus === "EXECUTED") {
    const overlapping = await findOverlappingExecutedContract(tx, {
      engineerId: c.engineerId,
      startDate: c.startDate,
      endDate: c.endDate,
      excludeContractId: c.id,
    });
    if (overlapping)
      return { error: { code: "VERSION_CONFLICT" as const, message: OVERLAP_MESSAGE } };
  }

  const updated = await tx.contract.updateMany({
    where: { id: contractId, [field]: null, status: c.status, version: expectedVersion },
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
    // 稼働開始後14日以内の終了: 手数料はキャンセル（0円）にする（§23）
    const updated = await tx.platformFee.updateMany({
      where: { contractId, status: "CHARGED" },
      data: { status: "CANCELLED", feeExTaxYen: 0 },
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
