// 本人訂正・削除請求（§26）
// 削除請求: 即時非公開・論理削除 → 14日以内に処理判断 → 30日後物理削除。
// 削除ログは個人情報を含めず保存する。

import { unlink } from "fs/promises";
import { Prisma } from "@prisma/client";
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

  // 物理削除の対象を洗い出す（PIIを不可逆に除去 §26）。
  // 経歴書原本ファイルはトランザクション外で削除するため、先にパスを控える。
  const engineer = await prisma.engineer.findUnique({
    where: { id: req.engineerId },
    select: { skillSheetDocumentId: true },
  });
  const skillSheetDocId = engineer?.skillSheetDocumentId ?? null;
  const skillSheetDoc = skillSheetDocId
    ? await prisma.sourceDocument.findUnique({
        where: { id: skillSheetDocId },
        select: { storagePath: true },
      })
    : null;
  // この人材のエントリー配下の開示・メッセージ・面談メモ（氏名・連絡先を含みうる）
  const entries = await prisma.entry.findMany({
    where: { engineerId: req.engineerId },
    select: { id: true },
  });
  const entryIds = entries.map((e) => e.id);

  await prisma.$transaction(async (tx) => {
    // 1. 人材本体のPIIカラムを不可逆に除去（原本の紐付けも解除）
    await tx.engineer.update({
      where: { id: req.engineerId },
      data: {
        name: "（削除済み）",
        residenceCity: null,
        nearestStation: null,
        summary: "",
        maskedSourceText: null, // 匿名化済み原文（氏名残存の可能性 §11）も除去
        nationality: null,
        workAuthExpiry: null,
        skillSheetDocumentId: null,
        status: "CLOSED",
      },
    });
    await tx.personConsent.deleteMany({ where: { engineerId: req.engineerId } });

    // 2. 経歴書原本: PII置換表 → 抽出結果 → 取込ジョブ → 原本レコードの順で削除
    if (skillSheetDocId) {
      const jobs = await tx.ingestionJob.findMany({
        where: { sourceDocumentId: skillSheetDocId },
        select: { id: true },
      });
      const jobIds = jobs.map((j) => j.id);
      if (jobIds.length > 0)
        await tx.extractionResult.deleteMany({ where: { ingestionJobId: { in: jobIds } } });
      await tx.piiTokenMap.deleteMany({ where: { sourceDocumentId: skillSheetDocId } });
      await tx.ingestionJob.deleteMany({ where: { sourceDocumentId: skillSheetDocId } });
      await tx.sourceDocument.delete({ where: { id: skillSheetDocId } });
    }

    // 3. Level 2 開示スナップショットの氏名・実額単価を除去（レコードは監査目的で残す）
    if (entryIds.length > 0) {
      const disclosures = await tx.disclosure.findMany({
        where: { entryId: { in: entryIds } },
      });
      for (const d of disclosures) {
        const payload = { ...(d.payload as Record<string, unknown>) };
        payload.engineerName = "（削除済み）";
        payload.engineerRateYen = null;
        await tx.disclosure.update({
          where: { id: d.id },
          data: { payload: payload as Prisma.InputJsonValue },
        });
      }
      // 4. メッセージ本文・面談メモ（氏名・連絡先を含みうる）を除去
      await tx.entryMessage.updateMany({
        where: { entryId: { in: entryIds } },
        data: { body: "（削除済み）" },
      });
      await tx.interview.updateMany({
        where: { entryId: { in: entryIds }, note: { not: null } },
        data: { note: null },
      });
    }

    await tx.privacyRequest.update({
      where: { id: requestId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  });

  // 5. 原本ファイルの実体を削除（DB確定後。存在しなくてもエラーにしない）
  if (skillSheetDoc?.storagePath) {
    await unlink(skillSheetDoc.storagePath).catch(() => {
      /* 既に削除済み・欠損でも物理削除の完了は妨げない */
    });
  }

  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "DeletionExecuted",
    targetType: "PrivacyRequest",
    targetId: requestId, // 個人情報を含めない（§26）
  });
  return { ok: true as const };
}
