import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { prisma } from "@/server/db";
import { listEntries } from "@/server/services/entries";
import { ENTRY_STATUS_LABELS } from "@/lib/constants";
import { Pager, parsePage, slicePage } from "@/components/Pager";

type EntryRow = NonNullable<Awaited<ReturnType<typeof listEntries>>[number]>;

// 表示上の状況: 片側承認の段階は視点によって「提案中」（相手の対応待ち）と
// 「確認待ち」（自社の対応待ち）に分かれる。それ以外は状態ラベルをそのまま使う
function displayStatusOf(e: EntryRow): { key: string; label: string } {
  if (["SUBMITTED", "SUPPLY_APPROVED", "DEMAND_APPROVED"].includes(e.status)) {
    const waitingOnUs =
      e.status === "SUBMITTED"
        ? !e.createdByOwn
        : (e.status === "SUPPLY_APPROVED" && e.side === "DEMAND") ||
          (e.status === "DEMAND_APPROVED" && e.side === "SUPPLY");
    return waitingOnUs
      ? { key: "PENDING_OWN", label: "確認待ち" }
      : { key: "PROPOSING", label: "提案中" };
  }
  return { key: e.status, label: ENTRY_STATUS_LABELS[e.status] ?? e.status };
}

const STATUS_OPTIONS: [string, string][] = [
  ["PROPOSING", "提案中"],
  ["PENDING_OWN", "確認待ち"],
  ["MUTUALLY_APPROVED", "双方承認済み"],
  ["INTERVIEW", "面談"],
  ["CONDITIONS", "条件調整"],
  ["CONTRACTING", "契約手続中"],
  ["CONTRACTED", "成約"],
  ["DECLINED", "見送り"],
  ["WITHDRAWN", "辞退"],
  ["ON_HOLD", "保留"],
];

const TABS: [string, string][] = [
  ["all", "すべて"],
  ["pending", "自社の対応待ち"],
  ["active", "進行中"],
  ["contracted", "成約済み"],
  ["closed", "終了"],
];

function inTab(tab: string, statusKey: string): boolean {
  switch (tab) {
    case "pending":
      return statusKey === "PENDING_OWN";
    case "active":
      return ["PROPOSING", "MUTUALLY_APPROVED", "INTERVIEW", "CONDITIONS", "CONTRACTING", "ON_HOLD"].includes(statusKey);
    case "contracted":
      return statusKey === "CONTRACTED";
    case "closed":
      return ["DECLINED", "WITHDRAWN"].includes(statusKey);
    default:
      return true;
  }
}

const TZ = "Asia/Tokyo";
function formatUpdated(v: string | Date): string {
  const d = new Date(v);
  const sameYear =
    d.toLocaleDateString("en-US", { year: "numeric", timeZone: TZ }) ===
    new Date().toLocaleDateString("en-US", { year: "numeric", timeZone: TZ });
  return d.toLocaleDateString("ja-JP", {
    ...(sameYear ? {} : { year: "numeric" as const }),
    month: "long",
    day: "numeric",
    timeZone: TZ,
  });
}

// 提案の起点アイコン: 右向き=自社が提案を開始 / 左向き=他社が提案を開始
function DirectionIcon({ own }: { own: boolean }) {
  const title = own ? "自社が提案を開始" : "他社が提案を開始";
  return (
    <svg
      viewBox="0 0 18 18"
      role="img"
      aria-label={title}
      className={`inline-block h-[18px] w-[18px] rounded-full align-[-4px] ${own ? "bg-blue-100 text-blue-600" : "bg-emerald-100 text-emerald-600"}`}
    >
      <title>{title}</title>
      {own ? (
        <path d="M5 9h7M9.5 6l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M13 9H6M8.5 6l-3 3 3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function statusBadgeClass(key: string): string {
  if (key === "PENDING_OWN") return "bg-amber-100 text-amber-800";
  if (key === "PROPOSING") return "bg-blue-50 text-blue-700";
  if (key === "CONTRACTED") return "bg-emerald-50 text-emerald-700";
  if (key === "DECLINED" || key === "WITHDRAWN") return "bg-slate-100 text-slate-500";
  return "bg-indigo-50 text-indigo-700";
}

// エントリー一覧（§20.1）: 自社案件・自社人材ごとにグループ化して表示する
export default async function EntriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const side = sp.side ?? "all"; // all | project(自社案件) | engineer(自社人材)
  const origin = sp.origin ?? "all"; // all | own(自社から) | other(他社から)
  const status = sp.status ?? "all";
  const action = sp.action ?? "all"; // all | own(自社の対応待ち) | other(相手の対応待ち)
  const member = sp.member ?? "all";
  const from = sp.from ?? "";
  const to = sp.to ?? "";
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "all";
  const page = parsePage(sp.page);

  const [all, members] = await Promise.all([
    listEntries(auth),
    prisma.companyMember.findMany({
      where: { companyId: auth.companyId, status: "ACTIVE" },
      include: { userAccount: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const fromAt = from ? new Date(`${from}T00:00:00+09:00`) : null;
  const toAt = to ? new Date(`${to}T23:59:59.999+09:00`) : null;

  const filtered = (all as EntryRow[]).filter((e) => {
    const ds = displayStatusOf(e);
    if (!inTab(tab, ds.key)) return false;
    if (side === "project" && e.side !== "DEMAND") return false;
    if (side === "engineer" && e.side !== "SUPPLY") return false;
    if (origin === "own" && !e.createdByOwn) return false;
    if (origin === "other" && e.createdByOwn) return false;
    if (status !== "all" && ds.key !== status) return false;
    if (action === "own" && ds.key !== "PENDING_OWN") return false;
    if (action === "other" && ds.key !== "PROPOSING") return false;
    if (member !== "all" && e.responsibleMemberId !== member) return false;
    const updated = new Date(e.updatedAt);
    if (fromAt && updated < fromAt) return false;
    if (toAt && updated > toAt) return false;
    if (q) {
      const haystack = [
        e.project.code,
        e.project.name,
        ...e.project.requiredSkills.map((s) => s.name),
        ...e.project.preferredSkills.map((s) => s.name),
        e.engineer.code,
        e.engineer.name ?? "",
        e.disclosure?.engineerName ?? "",
        ...e.engineer.skills.map((s) => s.name),
      ]
        .join("\n")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // 自社案件・自社人材ごとに1グループへまとめる（同じ組み合わせのエントリーは元々1件 = 1行）
  type Group = { key: string; kind: string; code: string; name: string; href: string; rows: EntryRow[] };
  const groupMap = new Map<string, Group>();
  for (const e of filtered) {
    const g =
      e.side === "DEMAND"
        ? { key: `p:${e.project.id}`, kind: "自社案件", code: e.project.code, name: e.project.name, href: `/projects/${e.project.id}` }
        : { key: `e:${e.engineer.id}`, kind: "自社人材", code: e.engineer.code, name: e.engineer.name ?? e.engineer.summary ?? "", href: `/engineers/${e.engineer.id}` };
    const existing = groupMap.get(g.key);
    if (existing) existing.rows.push(e);
    else groupMap.set(g.key, { ...g, rows: [e] });
  }
  const groups = [...groupMap.values()];
  for (const g of groups) g.rows.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  // グループは配下の明細で最も新しい更新日の順
  groups.sort((a, b) => +new Date(a.rows[0].updatedAt) < +new Date(b.rows[0].updatedAt) ? 1 : -1);
  const pageGroups = slicePage(groups, page);

  const filterParams: Record<string, string | undefined> = {
    q: sp.q || undefined,
    side: side !== "all" ? side : undefined,
    origin: origin !== "all" ? origin : undefined,
    status: status !== "all" ? status : undefined,
    action: action !== "all" ? action : undefined,
    member: member !== "all" ? member : undefined,
    from: from || undefined,
    to: to || undefined,
  };
  const tabHref = (t: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filterParams)) if (v) p.set(k, v);
    if (t !== "all") p.set("tab", t);
    const qs = p.toString();
    return qs ? `/entries?${qs}` : "/entries";
  };

  const select = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm";
  const label = "text-xs text-slate-600";

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">エントリー</h1>

      {/* 検索条件 */}
      <form method="GET" action="/entries" className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {tab !== "all" && <input type="hidden" name="tab" value={tab} />}
        <div className="mb-3 flex items-center gap-2">
          <span className={label}>キーワード</span>
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="案件名・人材名・ID・スキル"
            className={`${select} w-96`}
          />
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="flex items-center gap-2">
            <span className={label}>自社側</span>
            <select name="side" defaultValue={side} className={select}>
              <option value="all">すべて</option>
              <option value="project">自社案件</option>
              <option value="engineer">自社人材</option>
            </select>
          </span>
          <span className="flex items-center gap-2">
            <span className={label}>提案元</span>
            <select name="origin" defaultValue={origin} className={select}>
              <option value="all">すべて</option>
              <option value="own">自社から（→）</option>
              <option value="other">他社から（←）</option>
            </select>
          </span>
          <span className="flex items-center gap-2">
            <span className={label}>状況</span>
            <select name="status" defaultValue={status} className={select}>
              <option value="all">すべて</option>
              {STATUS_OPTIONS.map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </span>
          <span className="flex items-center gap-2">
            <span className={label}>対応</span>
            <select name="action" defaultValue={action} className={select}>
              <option value="all">すべて</option>
              <option value="own">自社の対応待ち</option>
              <option value="other">相手の対応待ち</option>
            </select>
          </span>
          <span className="flex items-center gap-2">
            <span className={label}>担当者</span>
            <select name="member" defaultValue={member} className={select}>
              <option value="all">すべて</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.userAccount.name}</option>
              ))}
            </select>
          </span>
          <span className="flex items-center gap-2">
            <span className={label}>更新日</span>
            <input type="date" name="from" defaultValue={from} className={select} />
            <span className="text-slate-400">〜</span>
            <input type="date" name="to" defaultValue={to} className={select} />
          </span>
        </div>
        <div className="flex gap-2">
          <button type="submit" className="rounded bg-slate-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
            検索
          </button>
          <Link href="/entries" className="rounded border border-slate-300 bg-white px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
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

      {/* 自社案件・自社人材ごとのグループ */}
      {pageGroups.map((g) => (
        <div key={g.key} className="mb-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <span className={`mr-2 rounded px-2 py-0.5 text-xs ${g.kind === "自社案件" ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800"}`}>
              {g.kind}
            </span>
            <Link href={g.href} className="font-bold text-slate-800 hover:underline">
              {g.code}{g.name ? `：${g.name}` : ""}
            </Link>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 w-32">状況</th>
                <th className="px-4 py-2">マッチング相手</th>
                <th className="px-4 py-2 w-48">相手企業</th>
                <th className="px-4 py-2 w-28">更新日</th>
                <th className="px-4 py-2 w-20">操作</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((e) => {
                const ds = displayStatusOf(e);
                const counterpart =
                  e.side === "DEMAND"
                    ? `${e.engineer.code}${e.disclosure?.engineerName ? ` ${e.disclosure.engineerName}` : ""}`
                    : `${e.project.code} ${e.project.name}`;
                return (
                  <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <span className={`rounded px-2 py-0.5 text-xs ${statusBadgeClass(ds.key)}`}>{ds.label}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="mr-1.5">
                        <DirectionIcon own={e.createdByOwn} />
                      </span>
                      {counterpart}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {e.counterpartCompanyName ?? <span className="text-slate-400">非公開</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{formatUpdated(e.updatedAt)}</td>
                    <td className="px-4 py-2.5">
                      <Link href={`/entries/${e.id}`} className="text-sm font-medium text-blue-700 hover:underline">
                        詳細
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      {groups.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-400 shadow-sm">
          条件に一致するエントリーはありません
        </div>
      )}

      <Pager total={groups.length} page={page} basePath="/entries" params={{ ...filterParams, tab: tab !== "all" ? tab : undefined }} />
      <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
        <DirectionIcon own={true} />：自社が提案を開始 ／ <DirectionIcon own={false} />：他社が提案を開始 ／ 相手企業名は双方合意後に表示されます
      </p>
    </div>
  );
}
