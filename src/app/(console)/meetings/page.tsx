import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasPermission } from "@/server/auth/rbac";
import { hasFeature } from "@/server/plan/features";
import { listCompanyInterviews, meetingAvailable } from "@/server/services/meetings";

// Web 会議（左メニュー。2026-11-05 郭指示）: 自社が当事者の面談を一覧にし、Web 会議（組込み）の面談はここから参加する。
// 会議室の作成・日時の変更は商談詳細の面談欄で行う
export const metadata = { title: "Web 会議" };

const fmt = (d: Date) => d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });

export default async function MeetingsPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!hasPermission(auth.roles, "entry.read")) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold">Web 会議</h1>
        <p className="text-sm text-stone-500">商談の閲覧権限がありません（entry.read）。</p>
      </div>
    );
  }
  const rows = await listCompanyInterviews(auth);
  const upcoming = rows.filter((r) => r.upcoming);
  const recent = rows.filter((r) => !r.upcoming).reverse();
  const canCreate = meetingAvailable() && hasFeature(auth, "web_meeting");

  const table = (list: typeof rows, emptyText: string) =>
    list.length === 0 ? (
      <p className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-400 shadow-sm">{emptyText}</p>
    ) : (
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs text-stone-500">
            <tr>
              <th className="px-3 py-2">日時</th>
              <th className="px-3 py-2">案件</th>
              <th className="hidden px-3 py-2 sm:table-cell">人材</th>
              <th className="hidden px-3 py-2 md:table-cell">相手企業</th>
              <th className="px-3 py-2">方法</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="border-t border-stone-100">
                <td className="whitespace-nowrap px-3 py-2 font-medium">
                  {fmt(r.scheduledAt)}
                  {r.status !== "SCHEDULED" && <span className="ml-1 text-xs text-stone-400">{r.status === "DONE" ? "終了" : "取消"}</span>}
                </td>
                <td className="px-3 py-2">
                  <span className={`mr-1 rounded px-1.5 py-0.5 text-xs ${r.side === "DEMAND" ? "bg-orange-100 text-orange-900" : "bg-purple-100 text-purple-800"}`}>
                    {r.side === "DEMAND" ? "自社案件" : "自社人材"}
                  </span>
                  {r.projectCode} {r.projectName}
                </td>
                <td className="hidden px-3 py-2 sm:table-cell">
                  {r.engineerCode}
                  {r.engineerName ? ` ${r.engineerName}` : ""}
                </td>
                <td className="hidden px-3 py-2 md:table-cell">{r.counterpartCompanyName ?? "-"}</td>
                <td className="px-3 py-2">
                  {r.method}
                  {r.note && <span className="ml-1 text-xs text-stone-400">{r.note}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {r.hasMeeting && r.status === "SCHEDULED" && (
                    <Link href={`/entries/${r.entryId}/meeting/${r.id}`} className="mr-2 rounded bg-orange-700 px-3 py-1 text-xs font-medium text-white hover:bg-orange-800">
                      参加
                    </Link>
                  )}
                  <Link href={`/entries/${r.entryId}`} className="text-xs text-orange-800 hover:underline">
                    商談を開く
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">Web 会議</h1>
      <p className="mb-6 text-sm text-stone-500">
        自社が当事者の面談の一覧です。Web会議（組込み）の面談は「参加」からコンソール内で参加できます（面談予定の前後1時間が目安）。
        面談の登録・日時の変更・会議室の作成は、商談詳細の面談欄で行います。
        {!canCreate && (
          <span className="ml-1">
            会議室の作成は PRO 版の機能です（相手企業が PRO 版なら参加は可能）。
            <Link href="/pricing" target="_blank" className="ml-1 text-orange-800 hover:underline">料金・機能比較</Link>
          </span>
        )}
      </p>

      <h2 className="mb-2 font-bold">今後の面談</h2>
      <div className="mb-8">{table(upcoming, "予定されている面談はありません")}</div>

      <h2 className="mb-2 font-bold">最近の面談（7日以内）</h2>
      {table(recent, "最近の面談はありません")}
    </div>
  );
}
