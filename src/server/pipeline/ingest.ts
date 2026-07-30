// 取込処理（§9.2）
// 受領 → 原本保存 → (ウイルス検査: MVP省略) → (OCR: MVP省略) → 種別分類
// → PII検出 → 匿名化 → LLM正規化 → JSON検証 → 人手確認 → 確定DB
// 原文・LLM抽出値・確定値は分離保存する。

import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "@/server/db";
import { maskPii, verifyMasked } from "./pii";
import { llmGateway } from "./llm";
import { audit } from "@/server/audit";

const STORAGE_DIR = process.env.STORAGE_DIR ?? "./storage";

export async function startIngestion(params: {
  tenantCompanyId: string;
  memberId: string;
  actorUserId: string;
  filename: string;
  mimeType: string;
  content: Buffer; // MVP はテキスト系ファイルのみ対応
}) {
  // 原本保存
  await mkdir(path.join(STORAGE_DIR, params.tenantCompanyId), { recursive: true });
  const storagePath = path.join(
    STORAGE_DIR,
    params.tenantCompanyId,
    `${Date.now()}_${params.filename}`
  );
  await writeFile(storagePath, params.content);

  const doc = await prisma.sourceDocument.create({
    data: {
      tenantCompanyId: params.tenantCompanyId,
      filename: params.filename,
      storagePath,
      mimeType: params.mimeType,
      size: params.content.length,
      uploadedByMemberId: params.memberId,
    },
  });
  const job = await prisma.ingestionJob.create({
    data: { tenantCompanyId: params.tenantCompanyId, sourceDocumentId: doc.id },
  });
  await audit({
    tenantCompanyId: params.tenantCompanyId,
    actorUserId: params.actorUserId,
    action: "DocumentReceived",
    targetType: "SourceDocument",
    targetId: doc.id,
    metadata: { filename: params.filename },
  });

  // MVP は同期実行（本番は非同期ジョブ §5, §32）
  try {
    const text = params.content.toString("utf-8");

    // PII検出・匿名化
    await prisma.ingestionJob.update({ where: { id: job.id }, data: { status: "MASKING" } });
    const { masked, tokens } = maskPii(text);

    // 置換表は保護ストアへ（MVPは別テーブル §25.3）
    if (tokens.length > 0) {
      await prisma.piiTokenMap.createMany({
        data: tokens.map((t) => ({
          sourceDocumentId: doc.id,
          token: t.token,
          originalValue: t.originalValue,
          kind: t.kind,
        })),
      });
    }

    // 匿名化検査: 残存PIIがあれば LLM 呼出しを停止する（§34）
    const check = verifyMasked(masked);
    if (!check.ok) {
      throw new Error(`PII_VALIDATION_FAILED: 匿名化検査で残存PIIを検出 (${check.findings.join(", ")})`);
    }
    await audit({
      tenantCompanyId: params.tenantCompanyId,
      actorUserId: params.actorUserId,
      action: "PiiMasked",
      targetType: "SourceDocument",
      targetId: doc.id,
      metadata: { tokenCount: tokens.length },
    });

    // 種別分類 → LLM正規化（匿名化済みテキストのみ送信 §25）
    await prisma.ingestionJob.update({ where: { id: job.id }, data: { status: "EXTRACTING" } });
    const kind = await llmGateway.classify(masked);
    if (kind === "UNKNOWN") throw new Error("文書種別を判定できませんでした");
    await prisma.sourceDocument.update({ where: { id: doc.id }, data: { kind } });
    const extracted = await llmGateway.extract(masked, kind);

    // 人手確認待ちへ
    await prisma.extractionResult.create({
      data: {
        ingestionJobId: job.id,
        maskedText: masked,
        extractedJson: extracted as object,
      },
    });
    await prisma.ingestionJob.update({
      where: { id: job.id },
      data: { status: "REVIEW_REQUIRED" },
    });
    await audit({
      tenantCompanyId: params.tenantCompanyId,
      actorUserId: params.actorUserId,
      action: "ExtractionCompleted",
      targetType: "IngestionJob",
      targetId: job.id,
      metadata: { kind },
    });
  } catch (e) {
    await prisma.ingestionJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: e instanceof Error ? e.message : String(e) },
    });
  }

  return prisma.ingestionJob.findUniqueOrThrow({
    where: { id: job.id },
    include: { extraction: true, sourceDocument: true },
  });
}
