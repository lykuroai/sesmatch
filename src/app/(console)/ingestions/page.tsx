import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { prisma } from "@/server/db";
import { INGESTION_STATUS_LABELS } from "@/lib/constants";
import { ActionButton } from "@/components/ActionButton";
import { IngestUpload } from "@/components/IngestUpload";
import { IngestPaste } from "@/components/IngestPaste";
import { ConfirmIngestionForm } from "@/components/ConfirmIngestionForm";
import { hasPermission } from "@/server/auth/rbac";

// 取込（§9）: ファイルアップロード → 匿名化 → LLM正規化 → 人手確認 → 確定
export default async function IngestionsPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const jobs = await prisma.ingestionJob.findMany({
    where: { tenantCompanyId: auth.companyId },
    include: { sourceDocument: true, extraction: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const canConfirm = hasPermission(auth.roles, "ingestion.confirm");

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">取込</h1>
      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-2 font-bold">テキスト貼り付け取込</h2>
        <p className="mb-4 text-xs text-slate-500">
          紹介メールの本文・スキルシート・案件票をそのまま貼り付けると、PII匿名化 → LLM正規化 →
          人手確認のパイプラインで処理されます。種別（スキルシート/案件票）は自動判定されます。
        </p>
        <IngestPaste />
      </section>

      <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-2 font-bold">ファイル取込</h2>
        <p className="mb-4 text-xs text-slate-500">
          テキスト/CSV ファイルのアップロードにも対応しています。
        </p>
        <IngestUpload />
      </section>

      <div className="space-y-4">
        {jobs.map((job) => (
          <div key={job.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{job.sourceDocument.filename}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {new Date(job.createdAt).toLocaleString("ja-JP")} /{" "}
                  {job.sourceDocument.kind === "ENGINEER_SHEET"
                    ? "スキルシート"
                    : job.sourceDocument.kind === "PROJECT_DESCRIPTION"
                      ? "案件票"
                      : "未分類"}
                </p>
              </div>
              <div className="flex items-center gap-3">
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
              </div>
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
                />
              )}
            {job.extraction && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-slate-500">
                  匿名化済みテキスト・抽出値を表示
                </summary>
                <div className="mt-2 grid grid-cols-2 gap-4">
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
        ))}
        {jobs.length === 0 && <p className="text-sm text-slate-400">取込履歴はありません</p>}
      </div>
    </div>
  );
}
