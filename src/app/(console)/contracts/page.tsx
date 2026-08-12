import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasPermission } from "@/server/auth/rbac";
import { listContracts } from "@/server/services/contracts";
import { CONTRACT_STATUS_LABELS } from "@/lib/constants";
import { Pager, parsePage, slicePage } from "@/components/Pager";

type ContractRow = NonNullable<Awaited<ReturnType<typeof listContracts>>[number]>;

const TABS: [string, string][] = [
  ["all", "すべて"],
  ["sign", "署名待ち"],
  ["executed", "成約（稼働前）"],
  ["active", "稼働中"],
  ["closed", "終了"],
];

function inTab(tab: string, status: string): boolean {
  switch (tab) {
    case "sign":
      return ["DRAFT", "SIGNED_SUPPLY", "SIGNED_DEMAND"].includes(status);
    case "executed":
      return status === "EXECUTED";
    case "active":
      return status === "ACTIVE";
    case "closed":
      return ["CANCELLED", "TERMINATED", "COMPLETED"].includes(status);
    default:
      return true;
  }
}

// 成約・稼働一覧: 条件確認書の署名状況と稼働状態を管理する
export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!hasPermission(auth.roles, "contract.read")) {
    return <p className="text-sm text-slate-500">成約情報の閲覧権限がありません。</p>;
  }
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const side = sp.side ?? "all"; // all | DEMAND | SUPPLY
  const contractType = sp.contractType ?? "all";
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "all";
  const page = parsePage(sp.page);

  const all = (await listContracts(auth)) as ContractRow[];
  const filtered = all.filter((c) => {
    if (!inTab(tab, c.status)) return false;
    if (side !== "all" && c.side !== side) return false;
    if (contractType !== "all" && c.contractType !== contractType) return false;
    if (q) {
      const haystack = [
        c.projectCode,
        c.projectName,
        c.engineerCode,
        c.engineerName,
        c.demandCompanyName,
        c.supplyCompanyName,
      ]
        .join("\n")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  const contracts = slicePage(filtered, page);

  const filterParams: Record<string, string | undefined> = {
    q: sp.q || undefined,
    side: side !== "all" ? side : undefined,
    contractType: contractType !== "all" ? contractType : undefined,
  };
  const tabHref = (t: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filterParams)) if (v) p.set(k, v);
    if (t !== "all") p.set("tab", t);
    const qs = p.toString();
    return qs ? `/contracts?${qs}` : "/contracts";
  };

  const select = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm";
  const label = "text-xs text-slate-600";

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">成約・稼働</h1>

      {/* 検索条件 */}
      <form method="GET" action="/contracts" className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {tab !== "all" && <input type="hidden" name="tab" value={tab} />}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="flex items-center gap-2">
            <span className={label}>キーワード</span>
            <input name="q" defaultValue={sp.q ?? ""} placeholder="案件名・人材名・ID・企業名" className={`${select} w-72`} />
          </span>
          <span className="flex items-center gap-2">
            <span className={label}>立場</span>
            <select name="side" defaultValue={side} className={select}>
              <option value="all">すべて</option>
              <option value="DEMAND">需要側（案件提供）</option>
              <option value="SUPPLY">供給側（人材提供）</option>
            </select>
          </span>
          <span className="flex items-center gap-2">
            <span className={label}>契約形態</span>
            <select name="contractType" defaultValue={contractType} className={select}>
              <option value="all">すべて</option>
              <option value="準委任">準委任</option>
              <option value="請負">請負</option>
              <option value="労働者派遣">労働者派遣</option>
            </select>
          </span>
          <button type="submit" className="rounded bg-slate-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
            検索
          </button>
          <Link href="/contracts" className="rounded border border-slate-300 bg-white px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
            条件をクリア
          </Link>
        </div>
      </form>

      {/* タブ */}
      <div className="mb-4 flex gap-2">
        {TABS.map(([k, v]) => (
          <Link
            key={k}
            href={tabHref(k)}
            className={`rounded px-3 py-1.5 text-sm ${tab === k ? "bg-slate-800 text-white" : "border border-slate-300 bg-white"}`}
          >
            {v}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">案件</th>
              <th className="px-4 py-3">人材</th>
              <th className="px-4 py-3">立場</th>
              <th className="px-4 py-3">契約形態</th>
              <th className="px-4 py-3">月額</th>
              <th className="px-4 py-3">署名</th>
              <th className="px-4 py-3">稼働開始</th>
              <th className="px-4 py-3">状態</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/contracts/${c.id}`} className="font-medium text-blue-700 hover:underline">
                    {c.projectCode} {c.projectName}
                  </Link>
                </td>
                <td className="px-4 py-3">{c.engineerCode} {c.engineerName}</td>
                <td className="px-4 py-3 text-xs">{c.side === "DEMAND" ? "需要側" : "供給側"}</td>
                <td className="px-4 py-3">{c.contractType}</td>
                <td className="px-4 py-3">{(c.monthlyRateYen / 10_000).toLocaleString()}万円</td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  供 {c.supplySigned ? "〇" : "未"} ／ 需 {c.demandSigned ? "〇" : "未"}
                </td>
                <td className="px-4 py-3 text-xs">
                  {c.workStartedAt ? new Date(c.workStartedAt).toLocaleDateString("ja-JP") : "-"}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded px-2 py-0.5 text-xs ${
                    c.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700"
                      : c.status === "CANCELLED" || c.status === "TERMINATED" || c.status === "COMPLETED" ? "bg-slate-100 text-slate-500"
                      : "bg-amber-50 text-amber-700"
                  }`}>
                    {CONTRACT_STATUS_LABELS[c.status]}
                  </span>
                </td>
              </tr>
            ))}
            {contracts.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  {all.length === 0
                    ? "成約はまだありません。条件確認書は商談詳細（商談開始後）から作成できます。"
                    : "条件に一致する成約はありません"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager total={filtered.length} page={page} basePath="/contracts" params={{ ...filterParams, tab: tab !== "all" ? tab : undefined }} />
    </div>
  );
}
