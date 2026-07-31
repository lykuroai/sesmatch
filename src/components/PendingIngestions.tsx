import Link from "next/link";

// 人材・案件一覧に表示する「取込 → 人手確認待ち」の一覧（§9.2）。
// 確認・確定の操作自体は /ingestions（取込履歴）で行う
export function PendingIngestions({
  jobs,
}: {
  jobs: { id: string; filename: string; createdAt: Date }[];
}) {
  if (jobs.length === 0) return null;
  return (
    <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-center justify-between">
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
  );
}
