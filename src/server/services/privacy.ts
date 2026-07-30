// 本人訂正・削除請求（§26）
// 削除請求: 即時非公開・論理削除 → 14日以内に処理判断 → 30日後物理削除。
// 削除ログは個人情報を含めず保存する。

import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/auth/session";

const DECISION_DAYS = 14;
const PURGE_AFTER_DAYS = 30;

export async function listPrivacyRequests(auth: AuthContext) {
  const requests = await prisma.privacyRequest.findMany({
    where: { tenantCompanyId: auth.companyId },
    orderBy: { requestedAt: "desc" },
  });
  const engineers = await prisma.engineer.findMany({
    where: { id: { in: requests.map((r) => r.engineerId) } },
    select: { id: true, code: true },
  });
  const codeById = new Map(engineers.map((e) => [e.id, e.code]));
  return requests.map((r) => ({ ...r, engineerCode: codeById.get(r.engineerId) ?? "?" }));
}

export async function createPrivacyRequest(
  auth: AuthContext,
  input: { engineerId: string; kind: "CORRECTION" | "DELETION"; reason?: string }
) {
  const engineer = await prisma.engineer.findFirst({
    where: { id: input.engineerId, tenantCompanyId: auth.companyId },
  });
  if (!engineer) return { error: { code: "NOT_FOUND" as const } };

  const request = await prisma.$transaction(async (tx) => {
    const req = await tx.privacyRequest.create({
      data: {
        tenantCompanyId: auth.companyId,
        engineerId: input.engineerId,
        kind: input.kind,
        reason: input.reason,
        decisionDeadline: new Date(Date.now() + DECISION_DAYS * 86_400_000),
      },
    });
    if (input.kind === "DELETION") {
      // 削除請求は即時非公開（§26）
      await tx.engineer.update({
        where: { id: input.engineerId },
        data: { status: "SUSPENDED" },
      });
    }
    return req;
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "PrivacyRequestReceived",
    targetType: "PrivacyRequest",
    targetId: request.id,
    metadata: { kind: input.kind }, // 個人情報は含めない
  });
  return { request };
}

// 処理判断（受付から14日以内 §26）。承認で論理削除し、30日後に物理削除可能となる。
export async function decidePrivacyRequest(
  auth: AuthContext,
  requestId: string,
  approve: boolean
) {
  const req = await prisma.privacyRequest.findFirst({
    where: { id: requestId, tenantCompanyId: auth.companyId },
  });
  if (!req) return { error: { code: "NOT_FOUND" as const } };
  if (req.status !== "RECEIVED")
    return { error: { code: "VERSION_CONFLICT" as const, message: "既に判断済みです" } };

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.privacyRequest.update({
      where: { id: requestId },
      data: {
        status: approve ? "APPROVED" : "REJECTED",
        decidedAt: now,
        decidedByMemberId: auth.memberId,
        scheduledPurgeAt:
          approve && req.kind === "DELETION"
            ? new Date(now.getTime() + PURGE_AFTER_DAYS * 86_400_000)
            : null,
      },
    });
    if (approve && req.kind === "DELETION") {
      await tx.engineer.update({
        where: { id: req.engineerId },
        data: { deletedAt: now, status: "SUSPENDED" }, // 論理削除
      });
    }
    if (!approve && req.kind === "DELETION") {
      // 却下時は非公開のまま（再公開は担当者の判断で実施）
    }
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: approve ? "PrivacyRequestApproved" : "PrivacyRequestRejected",
    targetType: "PrivacyRequest",
    targetId: requestId,
  });
  return { ok: true as const };
}

// 物理削除の実行（論理削除の30日後以降 §26）
// PII カラムを不可逆に除去し、同意記録を削除する。削除ログに個人情報を含めない。
export async function executePurge(auth: AuthContext, requestId: string) {
  const req = await prisma.privacyRequest.findFirst({
    where: { id: requestId, tenantCompanyId: auth.companyId },
  });
  if (!req) return { error: { code: "NOT_FOUND" as const } };
  if (req.status !== "APPROVED" || req.kind !== "DELETION")
    return { error: { code: "VERSION_CONFLICT" as const, message: "承認済みの削除請求のみ実行できます" } };
  if (req.scheduledPurgeAt && req.scheduledPurgeAt > new Date())
    return {
      error: {
        code: "VERSION_CONFLICT" as const,
        message: `物理削除は ${req.scheduledPurgeAt.toLocaleDateString("ja-JP")} 以降に実行できます（論理削除から30日）`,
      },
    };

  await prisma.$transaction(async (tx) => {
    await tx.engineer.update({
      where: { id: req.engineerId },
      data: {
        name: "（削除済み）",
        residenceCity: null,
        nearestStation: null,
        summary: "",
        status: "CLOSED",
      },
    });
    await tx.personConsent.deleteMany({ where: { engineerId: req.engineerId } });
    await tx.privacyRequest.update({
      where: { id: requestId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "DeletionExecuted",
    targetType: "PrivacyRequest",
    targetId: requestId, // 個人情報を含めない（§26）
  });
  return { ok: true as const };
}
