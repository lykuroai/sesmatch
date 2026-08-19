// 取込処理（§9.2）
// 受領 → 原本保存 → (ウイルス検査: MVP省略) → OCR（画像・画像PDFのみ、ローカル実行） → 種別分類
// → PII検出 → 匿名化 → LLM正規化 → JSON検証 → 人手確認 → 確定DB
// 原文・LLM抽出値・確定値は分離保存する。

import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "@/server/db";
import { llmGateway } from "./llm";
import { extractDocumentText } from "./extract-text";
import { splitFilename, splitProjectItems } from "./split";
import { demoteLearnableSkills } from "./skill-rules";
import { audit } from "@/server/audit";

export const STORAGE_DIR = process.env.STORAGE_DIR ?? "./storage";

// 取込パネルで指定される期待種別（案件取込 / 人材取込）
export type ExpectedKind = "ENGINEER_SHEET" | "PROJECT_DESCRIPTION";

const KIND_LABELS: Record<ExpectedKind, string> = {
  ENGINEER_SHEET: "人材（スキルシート）",
  PROJECT_DESCRIPTION: "案件",
};

// 保存用ファイル名をUTF-8のバイト長で安全に切り詰める（ext4等の255バイト制限対策。拡張子は保持）。
// 表示用の filename（DB）は切り詰めず、ディスク上のパスだけを短くする。
// パストラバーサル対策（§31）: ディレクトリ区切り・先頭ドットを除去し、保存先ディレクトリの
// 脱出（`../` 等による他テナント領域や任意パスへの書き込み）を防ぐ。
export function truncateFilenameBytes(filename: string, maxBytes: number): string {
  const safe = path
    .basename(filename) // ディレクトリ部を除去（posixのセパレータ）
    .replace(/[/\\]/g, "_") // 残存する区切り（Windows形式等）も無効化
    .replace(/^\.+/, ""); // 先頭ドット（`..` 等）を除去
  const ext = path.extname(safe).slice(0, 20);
  const base = safe.slice(0, safe.length - ext.length);
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
  expectedKind?: ExpectedKind; // 取込元パネルの期待種別。指定時はLLM分類との不一致を失敗にする
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
    data: {
      tenantCompanyId: params.tenantCompanyId,
      sourceDocumentId: doc.id,
      expectedKind: params.expectedKind ?? null,
    },
  });
  await audit({
    tenantCompanyId: params.tenantCompanyId,
    actorUserId: params.actorUserId,
    action: "DocumentReceived",
    targetType: "SourceDocument",
    targetId: doc.id,
    metadata: { filename: params.filename, expectedKind: params.expectedKind ?? null },
  });

  // 非同期実行（§5, §32）: 受付後すぐジョブを返し、テキスト抽出（OCR含む）〜LLM正規化は裏で進める。
  // 同期実行だと画像OCR等で応答が60秒を超え、プロキシやモバイルブラウザ側で通信が切れて
  // 「取込失敗」に見えるため（処理状況は取込履歴の status で確認できる）
  void processDocument({
    tenantCompanyId: params.tenantCompanyId,
    actorUserId: params.actorUserId,
    memberId: params.memberId,
    docId: doc.id,
    jobId: job.id,
    filename: params.filename,
    content: params.content,
    expectedKind: params.expectedKind,
  });

  return prisma.ingestionJob.findUniqueOrThrow({
    where: { id: job.id },
    include: { extraction: true, sourceDocument: true },
  });
}

// テキスト抽出（OCR含む）→ パイプライン本体。失敗はジョブに記録し、例外は投げない
async function processDocument(params: {
  tenantCompanyId: string;
  actorUserId: string;
  memberId?: string | null;
  docId: string;
  jobId: string;
  filename: string;
  content: Buffer;
  expectedKind?: ExpectedKind;
}) {
  let text: string;
  try {
    text = await extractDocumentText(params.filename, params.content);
  } catch (e) {
    await prisma.ingestionJob
      .update({
        where: { id: params.jobId },
        data: { status: "FAILED", error: e instanceof Error ? e.message : String(e) },
      })
      .catch(() => {});
    return;
  }

  // 複数案件が含まれる場合（【案件名】見出しが2つ以上）は案件ごとに分割し、
  // それぞれ別の取込（原本・ジョブ・人手確認）として処理する。
  // 人材取込（期待種別=ENGINEER_SHEET）では分割しない: スキルシートの職務経歴は
  // 「案件名」「期間」「業務内容」等が経歴ごとに繰り返される構造のため、案件分割の
  // 見出し判定に誤ヒットして1名分の経歴が裁断されるのを防ぐ
  const segments =
    params.expectedKind === "ENGINEER_SHEET" ? [text] : splitProjectItems(text);

  // 分割済み（ファイル名に（i/N）付き）のジョブの再実行では分割し直さない。
  // 1件目の原本には全文が保存されているため、自分の担当分（先頭セグメント）のみ処理する
  if (/（\d+\/\d+）/.test(params.filename)) {
    await runPipeline({
      tenantCompanyId: params.tenantCompanyId,
      actorUserId: params.actorUserId,
      docId: params.docId,
      jobId: params.jobId,
      text: segments[0],
      expectedKind: params.expectedKind,
    });
    return;
  }

  if (segments.length > 1) {
    // 分割前に文書全体の種別を確認する。
    // 全体がスキルシートなら分割しない: 職務経歴の「案件名」繰り返しに分割判定が
    // 誤ヒットした場合に、経歴の断片が案件として誤登録されるのを防ぐ
    // （LLM送信禁止は2026-08-19に全面撤廃 §25.2。原文をそのまま送信する）
    const wholeKind = await llmGateway.classify(text).catch(() => "UNKNOWN" as const);
    if (wholeKind === "ENGINEER_SHEET") {
      if (params.expectedKind === "PROJECT_DESCRIPTION") {
        await prisma.ingestionJob
          .update({
            where: { id: params.jobId },
            data: {
              status: "FAILED",
              error:
                `KIND_MISMATCH: この書類は${KIND_LABELS.ENGINEER_SHEET}と判定されました。` +
                `${KIND_LABELS.PROJECT_DESCRIPTION}の取込パネルからは取り込めません。` +
                `${KIND_LABELS.ENGINEER_SHEET}の取込から取り込み直してください`,
            },
          })
          .catch(() => {});
        return;
      }
      await runPipeline({
        tenantCompanyId: params.tenantCompanyId,
        actorUserId: params.actorUserId,
        docId: params.docId,
        jobId: params.jobId,
        text,
        expectedKind: params.expectedKind,
      });
      return;
    }
    await processSegments(params, segments);
    return;
  }

  await runPipeline({
    tenantCompanyId: params.tenantCompanyId,
    actorUserId: params.actorUserId,
    docId: params.docId,
    jobId: params.jobId,
    text,
    expectedKind: params.expectedKind,
  });
}

// 分割された案件テキストを順に処理する。
// 1件目は元の原本・ジョブを使い、2件目以降は分割分の原本（PII置換表を分離するため）とジョブを作成する
async function processSegments(
  params: {
    tenantCompanyId: string;
    actorUserId: string;
    memberId?: string | null;
    docId: string;
    jobId: string;
    filename: string;
    expectedKind?: ExpectedKind;
  },
  segments: string[]
) {
  const total = segments.length;
  // 元の原本の表示名に（1/N）を付けて分割されたことを分かるようにする
  await prisma.sourceDocument
    .update({
      where: { id: params.docId },
      data: { filename: splitFilename(params.filename, 1, total) },
    })
    .catch(() => {});

  for (let i = 0; i < total; i++) {
    let docId = params.docId;
    let jobId = params.jobId;
    if (i > 0) {
      const filename = splitFilename(params.filename, i + 1, total);
      const content = Buffer.from(segments[i], "utf-8");
      await mkdir(path.join(STORAGE_DIR, params.tenantCompanyId), { recursive: true });
      const storagePath = path.join(
        STORAGE_DIR,
        params.tenantCompanyId,
        `${Date.now()}_${truncateFilenameBytes(filename, 180)}`
      );
      await writeFile(storagePath, content);
      const doc = await prisma.sourceDocument.create({
        data: {
          tenantCompanyId: params.tenantCompanyId,
          filename,
          storagePath,
          mimeType: "text/plain",
          size: content.length,
          uploadedByMemberId: params.memberId ?? null,
        },
      });
      const job = await prisma.ingestionJob.create({
        data: {
          tenantCompanyId: params.tenantCompanyId,
          sourceDocumentId: doc.id,
          expectedKind: params.expectedKind ?? null,
        },
      });
      await audit({
        tenantCompanyId: params.tenantCompanyId,
        actorUserId: params.actorUserId,
        action: "DocumentReceived",
        targetType: "SourceDocument",
        targetId: doc.id,
        metadata: { filename, splitFromDocumentId: params.docId, part: `${i + 1}/${total}` },
      });
      docId = doc.id;
      jobId = job.id;
    }
    await runPipeline({
      tenantCompanyId: params.tenantCompanyId,
      actorUserId: params.actorUserId,
      docId,
      jobId,
      text: segments[i],
      expectedKind: params.expectedKind,
    });
  }
}

// パイプライン本体（分類 → LLM正規化 → 人手確認待ち）。
// LLM送信禁止・取込時のPIIマスキングは2026-08-19に全面撤廃（§25.2。郭指示）。
// 原文をそのままLLMへ送信する（事業者はゼロデータ保持・学習オプトアウト契約 §25.4 が前提）。
// 公開画面の匿名性（Level 1 の非開示・匿名要約）と段階開示は従来どおり維持する。
// 失敗はジョブの status/error に記録し、例外は投げない
async function runPipeline(params: {
  tenantCompanyId: string;
  actorUserId: string;
  docId: string;
  jobId: string;
  text: string;
  expectedKind?: ExpectedKind;
}) {
  const { tenantCompanyId, actorUserId, docId, jobId, text, expectedKind } = params;
  try {
    const masked = text; // マスキング廃止後も保存カラム名（maskedText）は互換のため維持

    // 種別分類 → LLM正規化
    await prisma.ingestionJob.update({ where: { id: jobId }, data: { status: "EXTRACTING", error: null } });
    const kind = await llmGateway.classify(masked);
    if (kind === "UNKNOWN") throw new Error("文書種別を判定できませんでした");
    // 期待種別との突き合わせ（案件取込は案件のみ・人材取込は人材のみ）。
    // 不一致は誤った側への登録を防ぐため失敗にし、正しい取込パネルへの再取込を促す
    if (expectedKind && kind !== expectedKind) {
      throw new Error(
        `KIND_MISMATCH: この書類は${KIND_LABELS[kind]}と判定されました。` +
          `${KIND_LABELS[expectedKind]}の取込パネルからは取り込めません。` +
          `${KIND_LABELS[kind]}の取込から取り込み直してください`
      );
    }
    await prisma.sourceDocument.update({ where: { id: docId }, data: { kind } });
    let extracted = await llmGateway.extract(masked, kind);
    // 案件: 「取得技術」等の習得予定と明記された技術はLLMが必須に入れても尚可へ移す（決定的な補正）
    if (kind === "PROJECT_DESCRIPTION") {
      const d = extracted as { requiredSkills?: string[]; preferredSkills?: string[] };
      extracted = {
        ...d,
        ...demoteLearnableSkills(masked, d.requiredSkills ?? [], d.preferredSkills ?? []),
      } as typeof extracted;
    }

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
  let content: Buffer;
  try {
    content = await readFile(job.sourceDocument.storagePath);
  } catch {
    return { error: { code: "VALIDATION_ERROR" as const, message: "原本ファイルが見つかりません" } };
  }
  await prisma.piiTokenMap.deleteMany({ where: { sourceDocumentId: job.sourceDocumentId } });
  await prisma.extractionResult.deleteMany({ where: { ingestionJobId: job.id } });
  // 受付状態に戻し、再処理（テキスト抽出〜LLM正規化）は非同期で実行する
  await prisma.ingestionJob.update({ where: { id: job.id }, data: { status: "RECEIVED", error: null } });
  void processDocument({
    tenantCompanyId: params.tenantCompanyId,
    actorUserId: params.actorUserId,
    memberId: job.sourceDocument.uploadedByMemberId,
    docId: job.sourceDocumentId,
    jobId: job.id,
    filename: job.sourceDocument.filename,
    content,
    // 再実行でも取込時の期待種別チェックを維持する（UNKNOWN は旧データ用の未指定扱い）
    expectedKind: job.expectedKind === "UNKNOWN" ? undefined : (job.expectedKind ?? undefined),
  });
  return prisma.ingestionJob.findUniqueOrThrow({
    where: { id: job.id },
    include: { extraction: true, sourceDocument: true },
  });
}
