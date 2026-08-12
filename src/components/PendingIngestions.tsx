import Link from "next/link";
import { AutoRefresh } from "./AutoRefresh";

// 人材・案件一覧に表示する「取込 → 人手確認待ち」の一覧（§9.2）。
// 確認・確定の操作自体は /ingestions（取込履歴）で行う。
// 解析中（OCR〜LLM正規化）の件数も表示し、処理中は自動更新で完了を反映する
export function PendingIngestions({
  jobs,
  processingCount = 0,
}: {
  jobs: { id: string; filename: string; createdAt: Date }[];
  processingCount?: number;
}) {
  if (jobs.length === 0 && processingCount === 0) return null;
  return (
    <>
      <AutoRefresh active={processingCount > 0} />
      {processingCount > 0 && (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          解析中の取込が {processingCount} 件あります（OCR・AI解析に1分ほどかかります。完了すると自動でここに表示されます）
        </div>
      )}
      {jobs.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-amber-800">
              取込済みで人手確認待ちのデータが {jobs.length} 件あります
            </p>
            <Link
              href="/ingestions"
              className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
            >
              確認して登録する
            </Link>
          </div>
          <ul className="mt-2 space-y-1">
            {jobs.map((job) => (
              <li key={job.id} className="text-xs text-amber-700">
                {new Date(job.createdAt).toLocaleString("ja-JP")} — {job.filename}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
