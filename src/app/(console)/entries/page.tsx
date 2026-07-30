import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { listEntries } from "@/server/services/entries";
import { ENTRY_STATUS_LABELS, ENTRY_TYPE_LABELS } from "@/lib/constants";

// エントリー一覧（§20.1: 送信・受信）
export default async function EntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ box?: string }>;
}) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const { box: boxParam } = await searchParams;
  const box = boxParam === "received" ? "received" : "sent";
  const all = await listEntries(auth);
  const entries = all.filter((e) => (box === "sent" ? e!.createdByOwn : !e!.createdByOwn));

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">エントリー</h1>
      <div className="mb-4 flex gap-2">
        <Link
          href="/entries"
          className={`rounded px-3 py-1.5 text-sm ${box === "sent" ? "bg-slate-800 text-white" : "bg-white border border-slate-300"}`}
        >
          送信（{all.filter((e) => e!.createdByOwn).length}）
        </Link>
        <Link
          href="/entries?box=received"
          className={`rounded px-3 py-1.5 text-sm ${box === "received" ? "bg-slate-800 text-white" : "bg-white border border-slate-300"}`}
        >
          受信（{all.filter((e) => !e!.createdByOwn).length}）
        </Link>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">種別</th>
              <th className="px-4 py-3">案件</th>
              <th className="px-4 py-3">人材</th>
              <th className="px-4 py-3">相手企業</th>
              <th className="px-4 py-3">状態</th>
              <th className="px-4 py-3">更新</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e!.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <span className={`rounded px-2 py-0.5 text-xs ${e!.type === "PROPOSAL" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"}`}>
                    {ENTRY_TYPE_LABELS[e!.type]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/entries/${e!.id}`} className="font-medium text-blue-700 hover:underline">
                    {e!.project.code} {e!.project.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {e!.engineer.code}
                  {e!.disclosure?.engineerName ? ` ${e!.disclosure.engineerName}` : ""}
                </td>
                <td className="px-4 py-3 text-xs">
                  {e!.counterpartCompanyName ?? <span className="text-slate-400">非開示（承認前）</span>}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded px-2 py-0.5 text-xs ${
                    e!.status === "MUTUALLY_APPROVED" || e!.status === "CONTRACTED"
                      ? "bg-emerald-50 text-emerald-700"
                      : e!.status === "DECLINED" || e!.status === "WITHDRAWN"
                        ? "bg-slate-100 text-slate-500"
                        : "bg-amber-50 text-amber-700"
                  }`}>
                    {ENTRY_STATUS_LABELS[e!.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {new Date(e!.createdAt).toLocaleDateString("ja-JP")}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  エントリーはありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
