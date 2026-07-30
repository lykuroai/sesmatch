import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { getDashboard } from "@/server/services/dashboard";

// ホームKPI（§8.3）
export default async function DashboardPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const kpi = await getDashboard(auth);

  const cards: { label: string; value: number | string; warn?: boolean }[] = [
    { label: "公開中案件", value: kpi.publishedProjects },
    { label: "営業中人材", value: kpi.publishedEngineers },
    { label: "承認待ちエントリー", value: kpi.pendingApprovals, warn: kpi.pendingApprovals > 0 },
    { label: "面談予定", value: kpi.upcomingInterviews },
    { label: "稼働中人数", value: kpi.activeContracts },
    { label: "今月手数料（税抜）", value: `${kpi.monthFeeYen.toLocaleString()}円` },
    { label: "人手確認待ち", value: kpi.reviewRequired, warn: kpi.reviewRequired > 0 },
    { label: "直近7日のマッチ計算", value: kpi.recentMatches },
    { label: "下書き人材", value: kpi.draftEngineers },
    { label: "同意期限警告（30日以内）", value: kpi.consentExpiring, warn: kpi.consentExpiring > 0 },
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">ホーム</h1>
      <div className="grid grid-cols-3 gap-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className={`rounded-xl border bg-white p-5 shadow-sm ${c.warn ? "border-amber-300" : "border-slate-200"}`}
          >
            <p className="text-sm text-slate-500">{c.label}</p>
            <p className={`mt-2 text-3xl font-bold ${c.warn ? "text-amber-600" : ""}`}>{c.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
