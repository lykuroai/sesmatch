// 取込処理（§9.2）
// 受領 → 原本保存 → (ウイルス検査: MVP省略) → (OCR: MVP省略) → 種別分類
// → PII検出 → 匿名化 → LLM正規化 → JSON検証 → 人手確認 → 確定DB
// 原文・LLM抽出値・確定値は分離保存する。

import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "@/server/db";
import { maskPii, verifyMasked } from "./pii";
import { llmGateway } from "./llm";
import { extractDocumentText } from "./extract-text";
import { audit } from "@/server/audit";

export const STORAGE_DIR = process.env.STORAGE_DIR ?? "./storage";

// 保存用ファイル名をUTF-8のバイト長で安全に切り詰める（ext4等の255バイト制限対策。拡張子は保持）。
// 表示用の filename（DB）は切り詰めず、ディスク上のパスだけを短くする。
export function truncateFilenameBytes(filename: string, maxBytes: number): string {
  const ext = path.extname(filename).slice(0, 20);
  const base = filename.slice(0, filename.length - ext.length);
  const budget = maxBytes - Buffer.byteLength(ext, "utf-8");
  let out = "";
  for (const ch of base) {
    if (Buffer.byteLength(out + ch, "utf-8") > budget) break;
    out += ch;
  }
  return (out || "document") + ext;
}

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
    `${Date.now()}_${truncateFilenameBytes(params.filename, 180)}`
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

  // ファイル形式に応じたテキスト抽出（PDF / Word / Excel / テキスト系）
  let text: string | null = null;
  try {
    text = await extractDocumentText(params.filename, params.content);
  } catch (e) {
    await prisma.ingestionJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: e instanceof Error ? e.message : String(e) },
    });
  }

  // MVP は同期実行（本番は非同期ジョブ §5, §32）
  if (text !== null) {
    await runPipeline({
      tenantCompanyId: params.tenantCompanyId,
      actorUserId: params.actorUserId,
      docId: doc.id,
      jobId: job.id,
      text,
    });
  }

  return prisma.ingestionJob.findUniqueOrThrow({
    where: { id: job.id },
    include: { extraction: true, sourceDocument: true },
  });
}

// パイプライン本体（PII匿名化 → 検査 → 分類 → LLM正規化 → 人手確認待ち）。
// 失敗はジョブの status/error に記録し、例外は投げない
async function runPipeline(params: {
  tenantCompanyId: string;
  actorUserId: string;
  docId: string;
  jobId: string;
  text: string;
}) {
  const { tenantCompanyId, actorUserId, docId, jobId, text } = params;
  try {
    // PII検出・匿名化
    await prisma.ingestionJob.update({ where: { id: jobId }, data: { status: "MASKING", error: null } });
    const { masked, tokens } = maskPii(text);

    // 置換表は保護ストアへ（MVPは別テーブル §25.3）
    if (tokens.length > 0) {
      await prisma.piiTokenMap.createMany({
        data: tokens.map((t) => ({
          sourceDocumentId: docId,
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
      tenantCompanyId,
      actorUserId,
      action: "PiiMasked",
      targetType: "SourceDocument",
      targetId: docId,
      metadata: { tokenCount: tokens.length },
    });

    // 種別分類 → LLM正規化（匿名化済みテキストのみ送信 §25）
    await prisma.ingestionJob.update({ where: { id: jobId }, data: { status: "EXTRACTING" } });
    const kind = await llmGateway.classify(masked);
    if (kind === "UNKNOWN") throw new Error("文書種別を判定できませんでした");
    await prisma.sourceDocument.update({ where: { id: docId }, data: { kind } });
    const extracted = await llmGateway.extract(masked, kind);

    // 人手確認待ちへ
    await prisma.extractionResult.create({
      data: {
        ingestionJobId: jobId,
        maskedText: masked,
        extractedJson: extracted as object,
      },
    });
    await prisma.ingestionJob.update({
      where: { id: jobId },
      data: { status: "REVIEW_REQUIRED" },
    });
    await audit({
      tenantCompanyId,
      actorUserId,
      action: "ExtractionCompleted",
      targetType: "IngestionJob",
      targetId: jobId,
      metadata: { kind },
    });
  } catch (e) {
    await prisma.ingestionJob.update({
      where: { id: jobId },
      data: { status: "FAILED", error: e instanceof Error ? e.message : String(e) },
    });
  }
}

// 失敗した取込ジョブの再実行（LLM側の一時障害等からの復旧用）。
// 保存済みの原本から同じジョブを再処理する。旧トークン・抽出結果は作り直す
export async function retryIngestion(params: {
  tenantCompanyId: string;
  actorUserId: string;
  jobId: string;
}) {
  const job = await prisma.ingestionJob.findFirst({
    where: { id: params.jobId, tenantCompanyId: params.tenantCompanyId },
    include: { sourceDocument: true },
  });
  if (!job) return { error: { code: "NOT_FOUND" as const } };
  if (job.status !== "FAILED")
    return { error: { code: "VERSION_CONFLICT" as const, message: "失敗したジョブのみ再実行できます" } };

  const { readFile } = await import("fs/promises");
  let text: string;
  try {
    const content = await readFile(job.sourceDocument.storagePath);
    text = await extractDocumentText(job.sourceDocument.filename, content);
  } catch (e) {
    return {
      error: {
        code: "VALIDATION_ERROR" as const,
        message: e instanceof Error ? e.message : "原本ファイルが見つかりません",
      },
    };
  }
  await prisma.piiTokenMap.deleteMany({ where: { sourceDocumentId: job.sourceDocumentId } });
  await prisma.extractionResult.deleteMany({ where: { ingestionJobId: job.id } });
  await runPipeline({
    tenantCompanyId: params.tenantCompanyId,
    actorUserId: params.actorUserId,
    docId: job.sourceDocumentId,
    jobId: job.id,
    text,
  });
  return prisma.ingestionJob.findUniqueOrThrow({
    where: { id: job.id },
    include: { extraction: true, sourceDocument: true },
  });
}
