import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { getDashboard } from "@/server/services/dashboard";

// ホームKPI（§8.3）
export default async function DashboardPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const kpi = await getDashboard(auth);

  const cards: { label: string; value: number | string; href?: string; warn?: boolean }[] = [
    { label: "公開中案件", value: kpi.publishedProjects, href: "/projects" },
    { label: "営業中人材", value: kpi.publishedEngineers, href: "/engineers" },
    { label: "承認待ちの商談申込み", value: kpi.pendingApprovals, href: "/entries?tab=pending", warn: kpi.pendingApprovals > 0 },
    { label: "面談予定", value: kpi.upcomingInterviews, href: "/entries" },
    { label: "稼働中人数", value: kpi.activeContracts, href: "/contracts" },
    { label: "今月手数料（税抜）", value: `${kpi.monthFeeYen.toLocaleString()}円`, href: "/billing" },
    { label: "人手確認待ち", value: kpi.reviewRequired, href: "/ingestions", warn: kpi.reviewRequired > 0 },
    { label: "直近7日のマッチ計算", value: kpi.recentMatches },
    { label: "下書き人材", value: kpi.draftEngineers, href: "/engineers" },
    { label: "同意期限警告（30日以内）", value: kpi.consentExpiring, href: "/engineers", warn: kpi.consentExpiring > 0 },
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">ホーム</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => {
          const inner = (
            <>
              <p className="text-sm text-slate-500">{c.label}</p>
              <p className={`mt-2 text-3xl font-bold ${c.warn ? "text-amber-600" : ""}`}>{c.value}</p>
            </>
          );
          const className = `block rounded-xl border bg-white p-5 shadow-sm ${c.warn ? "border-amber-300" : "border-slate-200"}`;
          return c.href ? (
            <Link key={c.label} href={c.href} className={`${className} transition hover:bg-slate-50 hover:shadow`}>
              {inner}
            </Link>
          ) : (
            <div key={c.label} className={className}>
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
