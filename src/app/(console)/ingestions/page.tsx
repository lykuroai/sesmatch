import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { prisma } from "@/server/db";
import { INGESTION_STATUS_LABELS } from "@/lib/constants";
import { ActionButton } from "@/components/ActionButton";
import { DeleteResourceButton } from "@/components/DeleteResourceButton";
import { ConfirmIngestionForm } from "@/components/ConfirmIngestionForm";
import { hasPermission } from "@/server/auth/rbac";
import { suggestPersonName } from "@/server/pipeline/pii";
import { Pager, parsePage } from "@/components/Pager";
import { LIST_PAGE_SIZE } from "@/lib/constants";
import { AutoRefresh } from "@/components/AutoRefresh";
import type { Prisma } from "@prisma/client";

type JobWithRelations = Prisma.IngestionJobGetPayload<{
  include: { sourceDocument: true; extraction: true };
}>;

// 取込履歴（§9.2）: 人手確認待ちの確認・確定と、過去の取込履歴の閲覧。
// 取込の実行（貼り付け・ファイル・カメラ撮影）は案件・人材画面の取込パネルから行う
export default async function IngestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const { page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const tenant = { tenantCompanyId: auth.companyId };
  // 履歴は人手確認待ち以外（確認待ちは上の専用セクションに全件表示する）
  const historyWhere = { ...tenant, status: { not: "REVIEW_REQUIRED" as const } };
  const [pending, total, jobs, processingCount] = await Promise.all([
    prisma.ingestionJob.findMany({
      where: { ...tenant, status: "REVIEW_REQUIRED" },
      include: { sourceDocument: true, extraction: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.ingestionJob.count({ where: historyWhere }),
    prisma.ingestionJob.findMany({
      where: historyWhere,
      include: { sourceDocument: true, extraction: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * LIST_PAGE_SIZE,
      take: LIST_PAGE_SIZE,
    }),
    prisma.ingestionJob.count({
      where: { ...tenant, status: { in: ["RECEIVED", "MASKING", "EXTRACTING"] } },
    }),
  ]);
  const canConfirm = hasPermission(auth.roles, "ingestion.confirm");

  // 人材の確認フォーム用: 匿名化時のPII置換表から氏名候補を引く（氏名はLLMに送らないため、
  // LLM抽出値ではなくローカル検出の結果を初期値として提示し、人が確認・修正する）
  const engineerDocIds = pending
    .filter((j) => j.sourceDocument.kind === "ENGINEER_SHEET")
    .map((j) => j.sourceDocumentId);
  const nameTokens = engineerDocIds.length
    ? await prisma.piiTokenMap.findMany({
        where: { sourceDocumentId: { in: engineerDocIds }, kind: "NAME" },
        select: { sourceDocumentId: true, kind: true, token: true, originalValue: true },
      })
    : [];
  const suggestedNames = new Map(
    engineerDocIds.map((docId) => [
      docId,
      suggestPersonName(nameTokens.filter((t) => t.sourceDocumentId === docId)),
    ])
  );

  const kindLabel = (job: JobWithRelations) =>
    job.sourceDocument.kind === "ENGINEER_SHEET"
      ? "スキルシート"
      : job.sourceDocument.kind === "PROJECT_DESCRIPTION"
        ? "案件票"
        : "未分類";

  const jobCard = (job: JobWithRelations) => (
    <div key={job.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="break-all font-medium">{job.sourceDocument.filename}</p>
          <p className="mt-1 text-xs text-slate-500">
            {new Date(job.createdAt).toLocaleString("ja-JP")} / {kindLabel(job)}
          </p>
        </div>
        <span className="flex items-center gap-2">
          <span
            className={`rounded px-2 py-1 text-xs font-medium ${
              job.status === "REVIEW_REQUIRED"
                ? "bg-amber-50 text-amber-700"
                : job.status === "CONFIRMED"
                  ? "bg-emerald-50 text-emerald-700"
                  : job.status === "FAILED"
                    ? "bg-red-50 text-red-700"
                    : "bg-slate-100 text-slate-600"
            }`}
          >
            {INGESTION_STATUS_LABELS[job.status]}
          </span>
          {/* 誤った取込の破棄（確定前のみ）。原本・抽出値ごと削除する */}
          {canConfirm && ["REVIEW_REQUIRED", "FAILED"].includes(job.status) && (
            <DeleteResourceButton
              path={`/api/v1/ingestions/${job.id}`}
              confirmText="この取込を削除しますか？（原本・抽出値ごと削除され、元に戻せません）"
              redirectTo="/ingestions"
            />
          )}
        </span>
      </div>
      {job.error && <p className="mt-2 text-xs text-red-600">{job.error}</p>}
      {job.status === "FAILED" && (
        <div className="mt-2">
          <ActionButton path={`/api/v1/ingestions/${job.id}/retry`} label="再実行" />
        </div>
      )}
      {canConfirm &&
        job.status === "REVIEW_REQUIRED" &&
        job.extraction &&
        job.sourceDocument.kind !== "UNKNOWN" && (
          <ConfirmIngestionForm
            jobId={job.id}
            kind={job.sourceDocument.kind as "ENGINEER_SHEET" | "PROJECT_DESCRIPTION"}
            extracted={job.extraction.extractedJson as never}
            suggestedName={suggestedNames.get(job.sourceDocumentId) ?? null}
          />
        )}
      {job.extraction && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-slate-500">
            匿名化済みテキスト・抽出値を表示
          </summary>
          <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
            <pre className="overflow-x-auto rounded bg-slate-50 p-3 text-xs">
              {job.extraction.maskedText}
            </pre>
            <pre className="overflow-x-auto rounded bg-slate-50 p-3 text-xs">
              {JSON.stringify(job.extraction.extractedJson, null, 2)}
            </pre>
          </div>
        </details>
      )}
    </div>
  );

  return (
    <div>
      {/* 解析中のジョブがある間は自動更新して完了を反映する */}
      <AutoRefresh active={processingCount > 0} />
      <h1 className="mb-2 text-2xl font-bold">取込履歴</h1>
      <p className="mb-6 text-xs text-slate-500">
        取込の実行（貼り付け・ファイル・カメラ撮影）は、案件・人材画面の「取込」ボタンから行えます。
      </p>
      {processingCount > 0 && (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          解析中の取込が {processingCount} 件あります（OCR・AI解析に1分ほどかかります。完了すると自動でここに表示されます）
        </div>
      )}

      {/* 人手確認待ち（全件表示） */}
      <h2 className="mb-3 text-lg font-bold">
        人手確認待ち
        {pending.length > 0 && (
          <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-sm font-medium text-amber-800">
            {pending.length}件
          </span>
        )}
      </h2>
      <div className="mb-8 space-y-4">
        {pending.map(jobCard)}
        {pending.length === 0 && <p className="text-sm text-slate-400">人手確認待ちの取込はありません</p>}
      </div>

      {/* 取込履歴（確認待ち以外） */}
      <h2 className="mb-3 text-lg font-bold">取込履歴</h2>
      <div className="space-y-4">
        {jobs.map(jobCard)}
        {jobs.length === 0 && <p className="text-sm text-slate-400">取込履歴はありません</p>}
      </div>
      <Pager total={total} page={page} basePath="/ingestions" />
    </div>
  );
}
