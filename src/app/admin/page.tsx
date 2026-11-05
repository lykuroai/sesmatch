"use client";

// 運営コンソール（企業承認〔CSV取込由来〕・通報対応。申込フローの企業は自動審査で即時開通）
// 認証は X-Admin-Token（.env の PLATFORM_ADMIN_TOKEN）。企業コンソールとは独立。
import { Fragment, useCallback, useEffect, useState } from "react";

type PendingCompany = {
  id: string;
  name: string;
  companyType: string;
  corporateNumber: string | null;
  address: string | null;
  createdAt: string;
  members: { name: string; email: string; roles: string[] }[];
};

type AdminCompany = {
  id: string;
  name: string;
  companyType: string;
  corporateNumber: string | null;
  address: string | null;
  dispatchLicenseNumber: string | null;
  dispatchLicenseExpiry: string | null;
  dispatchManagerName: string | null;
  status: string;
  createdAt: string;
  // 利用プラン（PRO版仕様書 §2）
  plan: "FREE" | "TRIAL" | "PRO";
  planStartedAt: string | null;
  planExpiresAt: string | null;
  planSeats: number;
  planBillingCycle: "MONTHLY" | "YEARLY";
  paymentMethod: "INVOICE" | "CARD";
  _count: { members: number };
};

const PLAN_LABEL: Record<AdminCompany["plan"], string> = { FREE: "基本版", TRIAL: "PRO お試し", PRO: "PRO" };
// 期限切れの TRIAL/PRO は実効 FREE（サーバ側 effectivePlan と同じ判定）
const planExpired = (co: AdminCompany) =>
  co.plan !== "FREE" && !!co.planExpiresAt && new Date(co.planExpiresAt).getTime() < Date.now();

type AdminMember = {
  id: string;
  name: string;
  email: string;
  status: string;
  roles: string[];
  passwordIssued: boolean;
};

type AdminReport = {
  id: string;
  reporterCompanyName: string;
  category: string;
  targetRef: string | null;
  body: string;
  status: string;
  createdAt: string;
};

type AdminInquiry = {
  id: string;
  code: string;
  companyName: string;
  priority?: boolean; // PRO 版からの問合せ（優先対応）
  category: string;
  body: string;
  status: string;
  createdAt: string;
  messages: { id: string; fromOperator: boolean; body: string; createdAt: string }[];
};

type AdminSystemError = {
  id: string;
  source: string;
  message: string;
  detail: string | null;
  tenantCompanyName: string | null;
  targetType: string | null;
  targetId: string | null;
  notifiedAt: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
};

// 機能ごとの画面（メニューで切り替え）
const MENU = [
  { key: "review", label: "企業承認" },
  { key: "companies", label: "企業一覧" },
  { key: "contracts", label: "契約・手数料" },
  { key: "plan", label: "PRO請求" },
  { key: "plan-requests", label: "PRO申込" },
  { key: "engineers", label: "人材稼働状況" },
  { key: "mail", label: "メール配信" },
  { key: "aliases", label: "用語辞書" },
  { key: "reports", label: "通報対応" },
  { key: "inquiries", label: "お問合せ" },
  { key: "errors", label: "エラーログ" },
] as const;
type MenuKey = (typeof MENU)[number]["key"];

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<PendingCompany[]>([]);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [inquiries, setInquiries] = useState<AdminInquiry[]>([]);
  const [allCompanies, setAllCompanies] = useState<AdminCompany[]>([]);
  const [errorLogs, setErrorLogs] = useState<AdminSystemError[]>([]);
  const [pendingPlanRequests, setPendingPlanRequests] = useState(0); // PRO申込の未処理件数（バッジ）
  const [unackedErrors, setUnackedErrors] = useState(0);
  const [tab, setTab] = useState<MenuKey>("review");

  // URL ハッシュ（#companies 等）と画面を同期し、リロード後も同じ画面を開く
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (MENU.some((m) => m.key === hash)) setTab(hash as MenuKey);
  }, []);
  function selectTab(key: MenuKey) {
    setTab(key);
    window.location.hash = key;
  }

  const load = useCallback(async (t: string) => {
    const headers = { "X-Admin-Token": t };
    const [cRes, rRes, aRes, qRes, eRes, pRes] = await Promise.all([
      fetch("/api/v1/operations/companies", { headers }),
      fetch("/api/v1/operations/reports", { headers }),
      fetch("/api/v1/operations/companies/all", { headers }),
      fetch("/api/v1/operations/inquiries", { headers }),
      fetch("/api/v1/operations/errors", { headers }),
      fetch("/api/v1/operations/plan-requests?status=PENDING", { headers }),
    ]);
    if (!cRes.ok || !rRes.ok || !aRes.ok || !qRes.ok || !eRes.ok || !pRes.ok) throw new Error("認証エラー");
    setPendingPlanRequests(((await pRes.json()) as { items: unknown[] }).items.length);
    setCompanies((await cRes.json()).items);
    setReports((await rRes.json()).items);
    setAllCompanies((await aRes.json()).items);
    setInquiries((await qRes.json()).items);
    const errs = await eRes.json();
    setErrorLogs(errs.items);
    setUnackedErrors(errs.unacknowledged);
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem("adminToken");
    if (saved) {
      setToken(saved);
      load(saved)
        .then(() => setAuthed(true))
        .catch(() => sessionStorage.removeItem("adminToken"));
    }
  }, [load]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await load(token);
      sessionStorage.setItem("adminToken", token);
      setAuthed(true);
    } catch {
      setError("運営トークンが違います");
    }
  }

  if (!authed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-900">
        <form onSubmit={login} className="w-96 rounded-xl bg-white p-8 shadow">
          <h1 className="mb-1 text-xl font-bold">運営コンソール</h1>
          <p className="mb-6 text-sm text-stone-500">運営トークンを入力してください</p>
          {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="mb-4 w-full rounded border border-stone-300 px-3 py-2 text-sm"
            placeholder="PLATFORM_ADMIN_TOKEN"
          />
          <button className="w-full rounded bg-stone-800 py-2 text-sm font-medium text-white hover:bg-stone-700">
            ログイン
          </button>
        </form>
      </main>
    );
  }

  const openReports = reports.filter((r) => r.status !== "RESOLVED").length;
  const openInquiries = inquiries.filter((q) => q.status !== "RESOLVED").length;
  const badge = (key: MenuKey) =>
    key === "review"
      ? companies.length
      : key === "reports"
        ? openReports
        : key === "inquiries"
          ? openInquiries
          : key === "errors"
            ? unackedErrors
            : key === "plan-requests"
              ? pendingPlanRequests
              : 0;

  return (
    <main className="min-h-screen bg-stone-100 p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">運営コンソール</h1>
          <button
            onClick={() => {
              sessionStorage.removeItem("adminToken");
              setAuthed(false);
              setToken("");
            }}
            className="text-xs text-stone-500 underline"
          >
            ログアウト
          </button>
        </div>
        {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

        <div className="flex items-start gap-6">
          <aside className="w-48 shrink-0 rounded-xl border border-stone-200 bg-white p-2 shadow-sm">
            {MENU.map((m) => (
              <button
                key={m.key}
                onClick={() => selectTab(m.key)}
                className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm ${
                  tab === m.key ? "bg-stone-800 font-medium text-white" : "text-stone-700 hover:bg-stone-100"
                }`}
              >
                <span>{m.label}</span>
                {badge(m.key) > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-xs ${
                      tab === m.key ? "bg-white text-stone-800" : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {badge(m.key)}
                  </span>
                )}
              </button>
            ))}
          </aside>

          <div className="min-w-0 flex-1">
            {tab === "review" && (
              <CompanyReviewSection token={token} companies={companies} reload={() => load(token)} />
            )}
            {tab === "companies" && (
              <CompanyListSection token={token} companies={allCompanies} reload={() => load(token)} />
            )}
            {tab === "contracts" && <ContractMonitorSection token={token} />}
            {tab === "plan" && <PlanInvoiceSection token={token} />}
            {tab === "plan-requests" && <PlanRequestSection token={token} onChanged={() => load(token)} />}
            {tab === "engineers" && <EngineerMonitorSection token={token} />}
            {tab === "mail" && <MailBroadcastSection token={token} />}
            {tab === "aliases" && <SkillAliasSection token={token} />}
            {tab === "reports" && (
              <ReportsSection token={token} reports={reports} reload={() => load(token)} />
            )}
            {tab === "inquiries" && (
              <InquiriesSection token={token} inquiries={inquiries} reload={() => load(token)} />
            )}
            {tab === "errors" && (
              <ErrorLogSection token={token} errors={errorLogs} reload={() => load(token)} />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

// 企業承認（CSV取込由来の承認待ち企業のみ）
function CompanyReviewSection({
  token,
  companies,
  reload,
}: {
  token: string;
  companies: PendingCompany[];
  reload: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null); // 詳細を開いている企業

  // 却下: 理由（任意）を入力し、申込者へ通知メールを送って申込データを削除する
  async function rejectOne(co: PendingCompany) {
    const reason = window.prompt(
      `${co.name} を却下しますか？\n却下理由（任意・申込者への通知メールに記載されます）:`,
      ""
    );
    if (reason === null) return; // キャンセル
    setError(null);
    const res = await fetch(`/api/v1/operations/companies/${co.id}/reject`, {
      method: "POST",
      headers: { "X-Admin-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() || undefined }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "却下に失敗しました");
      return;
    }
    setOpenId(null);
    await reload();
  }

  async function approveOne(co: PendingCompany) {
    if (
      !window.confirm(
        `${co.name} を承認して開通しますか？\n申込フローの代表には承認通知メールが送信されます（CSV取込企業の担当者へは、開通後に「初期パスワード再発行」で個別に発行してください）。`
      )
    )
      return;
    setError(null);
    const res = await fetch(`/api/v1/operations/companies/${co.id}/approve`, {
      method: "POST",
      headers: { "X-Admin-Token": token, "Content-Type": "application/json" },
      body: "{}",
    });
    if (res.ok) await reload();
    else setError("操作に失敗しました");
  }

  async function approveAll() {
    if (
      !window.confirm(
        `承認待ち ${companies.length} 社をすべて承認して開通しますか？\nCSV取込企業の担当者へは初期パスワードを自動発行しません。`
      )
    )
      return;
    setError(null);
    setBulkApproving(true);
    setBulkProgress(0);
    try {
      for (const [i, co] of companies.entries()) {
        const res = await fetch(`/api/v1/operations/companies/${co.id}/approve`, {
          method: "POST",
          headers: { "X-Admin-Token": token, "Content-Type": "application/json" },
          body: "{}",
        });
        if (!res.ok) {
          const b = await res.json().catch(() => null);
          setError(`${co.name}: ${b?.error?.message ?? "承認に失敗しました"}（${i} 社まで承認済み）`);
          break;
        }
        setBulkProgress(i + 1);
      }
      await reload();
    } finally {
      setBulkApproving(false);
    }
  }

  return (
    <div>
      {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

        <section className="mb-8 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">企業承認（承認待ち {companies.length}件・CSV取込由来のみ）</h2>
          {companies.length === 0 && (
            <p className="text-sm text-stone-400">
              承認待ちの企業はありません（申込フローは自動審査で即時開通するため、ここにはCSV取込企業のみ表示されます）
            </p>
          )}
          {companies.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded border border-stone-100 bg-stone-50 p-3">
              <p className="w-full text-xs text-stone-500">
                承認すると企業が有効になります。CSV取込企業の担当者へは初期パスワードを自動発行しません。
                開通後、各担当者の「初期パスワード再発行」で個別に発行してください。
              </p>
              <button
                onClick={approveAll}
                disabled={bulkApproving}
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                {bulkApproving ? `全件承認中... (${bulkProgress}/${companies.length})` : "全件承認"}
              </button>
            </div>
          )}
          <div className="space-y-2">
            {companies.map((co) => (
              <div key={co.id} className="rounded border border-stone-100 p-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{co.name}</p>
                    <p className="text-xs text-stone-500">
                      {co.companyType === "CORPORATION" ? "法人" : "個人事業者"}
                      ／ 申込: {new Date(co.createdAt).toLocaleString("ja-JP")}
                    </p>
                  </div>
                  <button
                    onClick={() => setOpenId(openId === co.id ? null : co.id)}
                    className="ml-3 shrink-0 rounded border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50"
                  >
                    {openId === co.id ? "閉じる" : "入力内容を確認"}
                  </button>
                </div>
                {openId === co.id && (
                  <div className="mt-3 rounded bg-stone-50 p-4">
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      <div>
                        <dt className="text-xs text-stone-500">企業名</dt>
                        <dd className="font-medium">{co.name}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-stone-500">企業形態</dt>
                        <dd>{co.companyType === "CORPORATION" ? "法人" : "個人事業者"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-stone-500">法人番号</dt>
                        <dd>{co.corporateNumber ?? "未入力"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-stone-500">所在地</dt>
                        <dd>{co.address ?? "未入力"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-stone-500">申込日時</dt>
                        <dd>{new Date(co.createdAt).toLocaleString("ja-JP")}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-stone-500">申込者</dt>
                        <dd>
                          {co.members.map((m) => (
                            <p key={m.email}>
                              {m.name}（{m.email}）
                              {m.roles.length > 0 && ` ／ ${m.roles.join(", ")}`}
                            </p>
                          ))}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-4 flex gap-3">
                      <button
                        onClick={() => approveOne(co)}
                        className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                      >
                        許可（承認して開通）
                      </button>
                      <button
                        onClick={() => rejectOne(co)}
                        className="rounded border border-red-300 bg-white px-4 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                      >
                        却下
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
    </div>
  );
}

// 企業一覧（修正・担当者・削除）
function CompanyListSection({
  token,
  companies,
  reload,
}: {
  token: string;
  companies: AdminCompany[];
  reload: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [editCompanyId, setEditCompanyId] = useState<string | null>(null);
  const [expandedCompanyId, setExpandedCompanyId] = useState<string | null>(null);
  const [planCompanyId, setPlanCompanyId] = useState<string | null>(null);
  const [editPlan, setEditPlan] = useState({
    plan: "FREE" as AdminCompany["plan"],
    planExpiresAt: "",
    planSeats: 5,
    paymentMethod: "INVOICE" as AdminCompany["paymentMethod"],
  });

  async function savePlan(id: string) {
    setError(null);
    const res = await fetch(`/api/v1/operations/companies/${id}/plan`, {
      method: "PUT",
      headers: { "X-Admin-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...editPlan,
        planExpiresAt: editPlan.plan === "FREE" ? null : editPlan.planExpiresAt || null,
        planSeats: Number(editPlan.planSeats),
      }),
    });
    if (res.ok) {
      setPlanCompanyId(null);
      await reload();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "プランの更新に失敗しました");
    }
  }
  const [editCo, setEditCo] = useState({
    name: "",
    companyType: "CORPORATION",
    corporateNumber: "",
    address: "",
    dispatchLicenseNumber: "",
    dispatchLicenseExpiry: "",
    dispatchManagerName: "",
  });

  async function saveCompany(id: string) {
    setError(null);
    const res = await fetch(`/api/v1/operations/companies/${id}`, {
      method: "PUT",
      headers: { "X-Admin-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify(editCo),
    });
    if (res.ok) {
      setEditCompanyId(null);
      await reload();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "企業情報の更新に失敗しました");
    }
  }

  // IP 制限の緊急解除（PRO版仕様書 §4.12。ロックアウト時のサポート用）
  async function unlockIp(co: AdminCompany) {
    if (!window.confirm(`${co.name} の IP アドレス制限を解除しますか？（監査に記録し、代表へメールします）`)) return;
    setError(null);
    const res = await fetch(`/api/v1/operations/companies/${co.id}/security/unlock`, { method: "PUT", headers: { "X-Admin-Token": token } });
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "IP 制限の解除に失敗しました");
    } else window.alert("IP アドレス制限を解除しました");
  }

  async function deleteCompany(co: AdminCompany) {
    if (
      !window.confirm(
        `${co.name} を削除しますか？（担当者 ${co._count.members} 名のアカウントも削除され、元に戻せません）`
      )
    )
      return;
    setError(null);
    const res = await fetch(`/api/v1/operations/companies/${co.id}`, {
      method: "DELETE",
      headers: { "X-Admin-Token": token },
    });
    if (res.ok) await reload();
    else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "企業の削除に失敗しました");
    }
  }

  const allCompanies = companies;
  return (
    <div>
        {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <section className="mb-8 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="mb-1 font-bold">企業一覧（{allCompanies.length}社）</h2>
          <p className="mb-3 text-xs text-stone-500">
            企業情報の全項目（企業名・種別・法人番号・所在地・派遣許可情報）と利用プラン（基本版／PRO お試し／PRO）をここで修正できます。
            PRO の請求は月額 39,800円（税別・5名込み）、お試しは既定30日です。
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs text-stone-500">
                <tr>
                  <th className="px-3 py-2">企業名</th>
                  <th className="px-3 py-2">種別</th>
                  <th className="px-3 py-2">法人番号</th>
                  <th className="px-3 py-2">状態</th>
                  <th className="px-3 py-2">プラン</th>
                  <th className="px-3 py-2">担当者数</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {allCompanies.map((co) => (
                  <Fragment key={co.id}>
                  {editCompanyId === co.id ? (
                    <tr className="border-t border-stone-100 bg-stone-50">
                      <td colSpan={7} className="px-3 py-3">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          <label className="block text-xs">
                            <span className="mb-1 block font-medium text-stone-600">企業名</span>
                            <input
                              value={editCo.name}
                              onChange={(e) => setEditCo({ ...editCo, name: e.target.value })}
                              className="w-full rounded border border-stone-300 px-2 py-1"
                            />
                          </label>
                          <label className="block text-xs">
                            <span className="mb-1 block font-medium text-stone-600">種別</span>
                            <select
                              value={editCo.companyType}
                              onChange={(e) => setEditCo({ ...editCo, companyType: e.target.value })}
                              className="w-full rounded border border-stone-300 px-2 py-1"
                            >
                              <option value="CORPORATION">法人</option>
                              <option value="SOLE_PROPRIETOR">個人事業者</option>
                            </select>
                          </label>
                          <label className="block text-xs">
                            <span className="mb-1 block font-medium text-stone-600">法人番号（13桁・任意）</span>
                            <input
                              value={editCo.corporateNumber}
                              onChange={(e) => setEditCo({ ...editCo, corporateNumber: e.target.value })}
                              placeholder="1234567890123"
                              className="w-full rounded border border-stone-300 px-2 py-1"
                            />
                          </label>
                          <label className="block text-xs md:col-span-3">
                            <span className="mb-1 block font-medium text-stone-600">所在地</span>
                            <input
                              value={editCo.address}
                              onChange={(e) => setEditCo({ ...editCo, address: e.target.value })}
                              placeholder="例: 東京都台東区上野1-1-1"
                              className="w-full rounded border border-stone-300 px-2 py-1"
                            />
                          </label>
                          <label className="block text-xs">
                            <span className="mb-1 block font-medium text-stone-600">労働者派遣事業許可番号</span>
                            <input
                              value={editCo.dispatchLicenseNumber}
                              onChange={(e) => setEditCo({ ...editCo, dispatchLicenseNumber: e.target.value })}
                              placeholder="例: 派13-123456"
                              className="w-full rounded border border-stone-300 px-2 py-1"
                            />
                          </label>
                          <label className="block text-xs">
                            <span className="mb-1 block font-medium text-stone-600">許可有効期限</span>
                            <input
                              type="date"
                              value={editCo.dispatchLicenseExpiry}
                              onChange={(e) => setEditCo({ ...editCo, dispatchLicenseExpiry: e.target.value })}
                              className="w-full rounded border border-stone-300 px-2 py-1"
                            />
                          </label>
                          <label className="block text-xs">
                            <span className="mb-1 block font-medium text-stone-600">派遣元責任者</span>
                            <input
                              value={editCo.dispatchManagerName}
                              onChange={(e) => setEditCo({ ...editCo, dispatchManagerName: e.target.value })}
                              className="w-full rounded border border-stone-300 px-2 py-1"
                            />
                          </label>
                        </div>
                        <div className="mt-3 flex justify-end gap-2 text-xs">
                          <button onClick={() => saveCompany(co.id)} className="rounded bg-orange-700 px-3 py-1.5 font-medium text-white hover:bg-orange-800">
                            保存
                          </button>
                          <button onClick={() => setEditCompanyId(null)} className="rounded border border-stone-300 px-3 py-1.5 hover:bg-stone-100">
                            取消
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr className="border-t border-stone-100">
                      <td className="px-3 py-2 font-medium">{co.name}</td>
                      <td className="px-3 py-2 text-xs">{co.companyType === "CORPORATION" ? "法人" : "個人事業者"}</td>
                      <td className="px-3 py-2 text-xs">{co.corporateNumber ?? <span className="text-amber-600">未登録</span>}</td>
                      <td className="px-3 py-2 text-xs">{co.status === "ACTIVE" ? "開通" : co.status === "APPLIED" ? "承認待ち" : "停止"}</td>
                      <td className="px-3 py-2 text-xs">
                        {co.plan === "FREE" ? (
                          <span className="text-stone-500">基本版</span>
                        ) : (
                          <span className={planExpired(co) ? "text-amber-600" : "font-medium text-emerald-700"}>
                            {PLAN_LABEL[co.plan]}
                            {planExpired(co) ? "（期限切れ）" : ""}
                            {co.planExpiresAt && (
                              <span className="ml-1 text-stone-500">〜{co.planExpiresAt.slice(0, 10)}</span>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {co._count.members}
                        {co.plan !== "FREE" && co._count.members > co.planSeats && (
                          <span className="ml-1 text-amber-600">（追加 {co._count.members - co.planSeats}名）</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-xs">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => {
                              setEditCompanyId(co.id);
                              setEditCo({
                                name: co.name,
                                companyType: co.companyType,
                                corporateNumber: co.corporateNumber ?? "",
                                address: co.address ?? "",
                                dispatchLicenseNumber: co.dispatchLicenseNumber ?? "",
                                dispatchLicenseExpiry: co.dispatchLicenseExpiry
                                  ? co.dispatchLicenseExpiry.slice(0, 10)
                                  : "",
                                dispatchManagerName: co.dispatchManagerName ?? "",
                              });
                            }}
                            className="rounded border border-stone-300 px-2 py-1 hover:bg-stone-50"
                          >
                            修正
                          </button>
                          <button
                            onClick={() => {
                              setPlanCompanyId(planCompanyId === co.id ? null : co.id);
                              setEditPlan({
                                plan: co.plan,
                                planExpiresAt: co.planExpiresAt ? co.planExpiresAt.slice(0, 10) : "",
                                planSeats: co.planSeats,
                                paymentMethod: co.paymentMethod,
                              });
                            }}
                            className="rounded border border-emerald-300 px-2 py-1 text-emerald-700 hover:bg-emerald-50"
                          >
                            プラン
                          </button>
                          <button
                            onClick={() => setExpandedCompanyId(expandedCompanyId === co.id ? null : co.id)}
                            className="rounded border border-stone-300 px-2 py-1 hover:bg-stone-50"
                          >
                            {expandedCompanyId === co.id ? "担当者を閉じる" : "担当者"}
                          </button>
                          <button
                            onClick={() => unlockIp(co)}
                            className="rounded border border-stone-300 px-2 py-1 hover:bg-stone-50"
                            title="IP アドレス制限の緊急解除（ロックアウト時）"
                          >
                            IP解除
                          </button>
                          <button
                            onClick={() => deleteCompany(co)}
                            className="rounded border border-red-300 px-2 py-1 text-red-600 hover:bg-red-50"
                          >
                            削除
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {planCompanyId === co.id && (
                    <tr className="bg-emerald-50/40">
                      <td colSpan={7} className="px-3 py-3">
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                          <label className="block text-xs">
                            <span className="mb-1 block font-medium text-stone-600">プラン</span>
                            <select
                              value={editPlan.plan}
                              onChange={(e) => setEditPlan({ ...editPlan, plan: e.target.value as AdminCompany["plan"] })}
                              className="w-full rounded border border-stone-300 px-2 py-1"
                            >
                              <option value="FREE">基本版</option>
                              <option value="TRIAL">PRO お試し</option>
                              <option value="PRO">PRO</option>
                            </select>
                          </label>
                          <label className="block text-xs">
                            <span className="mb-1 block font-medium text-stone-600">期限（空欄: お試し30日／PRO 無期限）</span>
                            <input
                              type="date"
                              value={editPlan.planExpiresAt}
                              disabled={editPlan.plan === "FREE"}
                              onChange={(e) => setEditPlan({ ...editPlan, planExpiresAt: e.target.value })}
                              className="w-full rounded border border-stone-300 px-2 py-1 disabled:bg-stone-100"
                            />
                          </label>
                          <label className="block text-xs">
                            <span className="mb-1 block font-medium text-stone-600">席数（月額に含む担当者数）</span>
                            <input
                              type="number"
                              min={1}
                              value={editPlan.planSeats}
                              onChange={(e) => setEditPlan({ ...editPlan, planSeats: Number(e.target.value) })}
                              className="w-full rounded border border-stone-300 px-2 py-1"
                            />
                          </label>
                          <label className="block text-xs">
                            <span className="mb-1 block font-medium text-stone-600">決済方法</span>
                            <select
                              value={editPlan.paymentMethod}
                              onChange={(e) => setEditPlan({ ...editPlan, paymentMethod: e.target.value as AdminCompany["paymentMethod"] })}
                              className="w-full rounded border border-stone-300 px-2 py-1"
                            >
                              <option value="INVOICE">請求書払い</option>
                              <option value="CARD">カード（Stripe）</option>
                            </select>
                          </label>
                        </div>
                        <p className="mt-2 text-xs text-stone-500">
                          期限切れの PRO／お試しは自動的に基本版として扱われます（データは保持）。開始当月は無料、翌月分から請求です。
                          カード決済（Stripe）で契約中の企業はプランと決済方法を変更できません（Stripe 側で解約後に変更）。
                        </p>
                        <div className="mt-3 flex justify-end gap-2 text-xs">
                          <button onClick={() => savePlan(co.id)} className="rounded bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700">
                            プランを保存
                          </button>
                          <button onClick={() => setPlanCompanyId(null)} className="rounded border border-stone-300 px-3 py-1.5 hover:bg-stone-100">
                            取消
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {expandedCompanyId === co.id && (
                    <tr className="bg-stone-50">
                      <td colSpan={7} className="px-3 py-3">
                        <CompanyMembersPanel companyId={co.id} token={token} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
    </div>
  );
}

// PRO 版の月額請求（PRO版仕様書 §6.1）: 月次の一括生成・一覧・入金消込・取消
type AdminPlanInvoice = {
  id: string;
  companyId: string;
  companyName: string;
  month: string;
  invoiceNumber: string;
  billingCycle: string;
  seats: number;
  activeMembers: number;
  extraSeats: number;
  amountExTaxYen: number;
  taxYen: number;
  totalYen: number;
  status: "ISSUED" | "PAID" | "VOID";
  dueAt: string;
  paidAt: string | null;
};

function PlanInvoiceSection({ token }: { token: string }) {
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [items, setItems] = useState<AdminPlanInvoice[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headers = { "X-Admin-Token": token, "Content-Type": "application/json" };

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/operations/plan-invoices`, { headers });
    if (res.ok) setItems(((await res.json()) as { items: AdminPlanInvoice[] }).items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    if (!window.confirm(`${month} 分の PRO 請求書を一括生成しますか？（対象企業の代表へメール通知されます）`)) return;
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/v1/operations/plan-invoices/generate?month=${month}`, { method: "POST", headers });
    const b = await res.json().catch(() => null);
    if (res.ok) {
      setMessage(`${b.month} 分: ${b.created}件発行、${b.skipped}件スキップ（発行済み・対象外）`);
      await load();
    } else setError(b?.error?.message ?? "生成に失敗しました");
  }
  async function act(id: string, action: "paid" | "void") {
    if (!window.confirm(action === "paid" ? "入金済みにしますか？" : "この請求書を取消しますか？")) return;
    setError(null);
    const res = await fetch(`/api/v1/operations/plan-invoices/${id}/${action}`, { method: "PUT", headers });
    if (res.ok) await load();
    else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "更新に失敗しました");
    }
  }
  const yen = (v: number) => `${v.toLocaleString()}円`;
  const statusLabel = { ISSUED: "未入金", PAID: "入金済み", VOID: "取消" } as const;
  return (
    <div>
      {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {message && <p className="mb-4 rounded bg-emerald-50 p-2 text-sm text-emerald-700">{message}</p>}
      <section className="mb-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-bold">PRO 版の月額請求</h2>
        <p className="mb-3 text-xs text-stone-500">
          対象月の1日時点で PRO・請求書払い・開始月が対象月より前の企業に請求書を発行します（企業×月で1枚。再実行は発行済みをスキップ）。
          金額は 39,800円 ＋ 追加担当者 4,000円/名（月払いのみ。年払いは廃止）。日割りなし。
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded border border-stone-300 px-2 py-1" />
          <button onClick={generate} className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">
            この月の請求書を一括生成
          </button>
        </div>
      </section>
      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-bold">請求書一覧（{items.length}件）</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2">対象月</th>
                <th className="px-3 py-2">番号</th>
                <th className="px-3 py-2">企業</th>
                <th className="px-3 py-2">担当者/席</th>
                <th className="px-3 py-2 text-right">税込</th>
                <th className="px-3 py-2">期限</th>
                <th className="px-3 py-2">状態</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-t border-stone-100">
                  <td className="px-3 py-2">{i.month}</td>
                  <td className="px-3 py-2 text-xs">{i.invoiceNumber}</td>
                  <td className="px-3 py-2">{i.companyName}</td>
                  <td className="px-3 py-2 text-xs">
                    {i.activeMembers}/{i.seats}
                    {i.extraSeats > 0 && <span className="ml-1 text-amber-600">+{i.extraSeats}</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{yen(i.totalYen)}</td>
                  <td className="px-3 py-2 text-xs">{i.dueAt.slice(0, 10)}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className={i.status === "PAID" ? "text-emerald-700" : i.status === "VOID" ? "text-stone-400 line-through" : "text-amber-700"}>
                      {statusLabel[i.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    {i.status === "ISSUED" && (
                      <div className="flex justify-end gap-2">
                        <button onClick={() => act(i.id, "paid")} className="rounded border border-emerald-300 px-2 py-1 text-emerald-700 hover:bg-emerald-50">入金消込</button>
                        <button onClick={() => act(i.id, "void")} className="rounded border border-red-300 px-2 py-1 text-red-600 hover:bg-red-50">取消</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

type AdminPlanRequest = {
  id: string;
  tenantCompanyId: string;
  companyName: string;
  companyPlan: "FREE" | "TRIAL" | "PRO";
  companyPlanExpiresAt: string | null;
  activeMembers: number;
  kind: "UPGRADE" | "CANCEL";
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  source: string;
  note: string | null;
  processedNote: string | null;
  processedAt: string | null;
  requestedByName: string | null;
  createdAt: string;
};

// PRO 版の申込・解約申請（2026-11-05）。承認で PRO 開始（請求書払い・月払い・無期限）／解約は当月末を期限に設定。却下は理由必須
function PlanRequestSection({ token, onChanged }: { token: string; onChanged: () => void }) {
  const [items, setItems] = useState<AdminPlanRequest[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const headers = { "X-Admin-Token": token, "Content-Type": "application/json" };

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/operations/plan-requests${showAll ? "" : "?status=PENDING"}`, { headers });
    if (res.ok) setItems(((await res.json()) as { items: AdminPlanRequest[] }).items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, showAll]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(r: AdminPlanRequest, action: "approve" | "reject") {
    let note: string | null = null;
    if (action === "reject") {
      note = window.prompt("却下理由（企業の代表へメールで通知されます）");
      if (!note?.trim()) return;
    } else {
      const text =
        r.kind === "UPGRADE"
          ? `${r.companyName} を PRO 版にします（請求書払い・月払い・開始当月無料、翌月分から月初請求）。代表へメール通知されます。よろしいですか？`
          : `${r.companyName} の解約を承認します（当月末まで PRO、翌月から基本版）。代表へメール通知されます。よろしいですか？`;
      if (!window.confirm(text)) return;
    }
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/v1/operations/plan-requests/${r.id}/${action}`, { method: "PUT", headers, body: JSON.stringify({ note }) });
    if (res.ok) {
      setMessage(action === "approve" ? "承認しました" : "却下しました");
      await load();
      onChanged();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "処理に失敗しました");
    }
  }
  const kindLabel = { UPGRADE: "PRO 申込", CANCEL: "解約申請" } as const;
  const statusLabel = { PENDING: "未処理", APPROVED: "承認", REJECTED: "却下", WITHDRAWN: "取り下げ" } as const;
  return (
    <div>
      {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {message && <p className="mb-4 rounded bg-emerald-50 p-2 text-sm text-emerald-700">{message}</p>}
      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">PRO 版の申込・解約申請（{items.length}件）</h2>
          <label className="flex items-center gap-1 text-xs text-stone-600">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            処理済みも表示
          </label>
        </div>
        <p className="mb-3 text-xs text-stone-500">
          新規登録画面・会社マイページからの自己申込です。承認すると PRO 開始（請求書払い・月払い・無期限）、解約は当月末を期限に設定します。
          規約の適用開始日 2026-12-04 より前は承認しないでください。お問合せ経由の申込は従来どおり「企業一覧 &gt; プラン」で変更します。
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2">申請日</th>
                <th className="px-3 py-2">企業</th>
                <th className="px-3 py-2">種別</th>
                <th className="px-3 py-2">現在</th>
                <th className="px-3 py-2">入口 / 申請者</th>
                <th className="px-3 py-2">備考</th>
                <th className="px-3 py-2">状態</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-t border-stone-100 align-top">
                  <td className="px-3 py-2 text-xs">{r.createdAt.slice(0, 10)}</td>
                  <td className="px-3 py-2">{r.companyName}</td>
                  <td className="px-3 py-2 text-xs">{kindLabel[r.kind]}</td>
                  <td className="px-3 py-2 text-xs">
                    {PLAN_LABEL[r.companyPlan]}
                    {r.companyPlanExpiresAt && <span className="ml-1 text-stone-500">〜{r.companyPlanExpiresAt.slice(0, 10)}</span>}
                    <span className="ml-1 text-stone-500">担当者{r.activeMembers}名</span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.source === "REGISTER" ? "新規登録" : "マイページ"}
                    {r.requestedByName && <span className="ml-1 text-stone-500">/ {r.requestedByName}</span>}
                  </td>
                  <td className="max-w-xs whitespace-pre-wrap px-3 py-2 text-xs text-stone-600">
                    {r.note}
                    {r.processedNote && <span className="block text-stone-400">運営: {r.processedNote}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">{statusLabel[r.status]}</td>
                  <td className="px-3 py-2 text-right text-xs">
                    {r.status === "PENDING" && (
                      <div className="flex justify-end gap-2">
                        <button onClick={() => act(r, "approve")} className="rounded border border-emerald-300 px-2 py-1 text-emerald-700 hover:bg-emerald-50">承認</button>
                        <button onClick={() => act(r, "reject")} className="rounded border border-red-300 px-2 py-1 text-red-600 hover:bg-red-50">却下</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-center text-xs text-stone-400">申請はありません</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// お問合せ対応（企業からの問い合わせフォーム）
function InquiriesSection({
  token,
  inquiries,
  reload,
}: {
  token: string;
  inquiries: AdminInquiry[];
  reload: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);

  async function post(path: string, body?: object) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "X-Admin-Token": token, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) await reload();
    else setError("操作に失敗しました");
  }

  return (
    <div>
      {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-bold">お問合せ対応</h2>
        <p className="mb-3 text-xs text-stone-500">
          企業コンソールの「お問合せ」フォームから届いた内容。回答は各企業の登録メールアドレスへ直接連絡する
        </p>
        {inquiries.length === 0 && <p className="text-sm text-stone-400">お問合せはありません</p>}
        <div className="space-y-2">
          {inquiries.map((q) => (
            <div key={q.id} className="rounded border border-stone-100 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {q.priority && <span className="mr-2 rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold text-white">PRO 優先</span>}
                  {q.code}　{q.category}
                  <span className="ml-2 text-xs font-normal text-stone-500">
                    {q.companyName} ／ {new Date(q.createdAt).toLocaleString("ja-JP")}
                  </span>
                </p>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      q.status === "OPEN"
                        ? "bg-amber-50 text-amber-700"
                        : q.status === "REVIEWING"
                          ? "bg-orange-50 text-orange-800"
                          : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {q.status === "OPEN" ? "未対応" : q.status === "REVIEWING" ? "対応中" : "対応済み"}
                  </span>
                  {q.status === "OPEN" && (
                    <button
                      onClick={() => post(`/api/v1/operations/inquiries/${q.id}/status`, { status: "REVIEWING" })}
                      className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50"
                    >
                      対応開始
                    </button>
                  )}
                  {q.status !== "RESOLVED" && (
                    <button
                      onClick={() => post(`/api/v1/operations/inquiries/${q.id}/status`, { status: "RESOLVED" })}
                      className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50"
                    >
                      対応済みにする
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-stone-700">{q.body}</p>
              {q.messages.length > 0 && (
                <div className="mt-2 space-y-2 border-l-2 border-stone-200 pl-3">
                  {q.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`rounded-lg p-2.5 text-sm ${m.fromOperator ? "bg-orange-50" : "bg-stone-50"}`}
                    >
                      <p className="mb-1 text-xs text-stone-500">
                        {m.fromOperator ? "運営" : q.companyName} ・ {new Date(m.createdAt).toLocaleString("ja-JP")}
                      </p>
                      <p className="whitespace-pre-wrap text-stone-700">{m.body}</p>
                    </div>
                  ))}
                </div>
              )}
              <AdminInquiryReply token={token} inquiryId={q.id} reload={reload} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// お問合せへのスレッド回答（運営）。送信すると状態は対応中になり、問い合わせ者へメール通知される
function AdminInquiryReply({
  token,
  inquiryId,
  reload,
}: {
  token: string;
  inquiryId: string;
  reload: () => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/v1/operations/inquiries/${inquiryId}/messages`, {
      method: "POST",
      headers: { "X-Admin-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setLoading(false);
    if (res.ok) {
      setBody("");
      await reload();
    } else setError("送信に失敗しました");
  }

  return (
    <form onSubmit={submit} className="mt-2">
      {error && <p className="mb-1 text-xs text-red-600">{error}</p>}
      <div className="flex items-start gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          maxLength={5000}
          className="min-w-0 flex-1 rounded border border-stone-300 px-3 py-2 text-sm"
          placeholder="回答を入力（送信すると企業側のお問合せページに表示され、担当者へメール通知されます）"
        />
        <button
          type="submit"
          disabled={loading || !body.trim()}
          className="rounded bg-orange-700 px-3 py-2 text-xs font-medium text-white hover:bg-orange-800 disabled:opacity-50"
        >
          {loading ? "送信中..." : "回答を送信"}
        </button>
      </div>
    </form>
  );
}

// 通報対応
// 用語辞書（§19 マッチングの名寄せ）: スキル・工程・業種名の表記ゆれ → 正規形。
// 承認済みエントリのみマッチングで使用される（現状の登録はすべて承認済み扱い）
function SkillAliasSection({ token }: { token: string }) {
  const [items, setItems] = useState<
    { id: string; alias: string; canonical: string; status: string; source: string; createdAt: string }[]
  >([]);
  const [alias, setAlias] = useState("");
  const [canonical, setCanonical] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/operations/skill-aliases", { headers: { "X-Admin-Token": token } });
    if (res.ok) setItems((await res.json()).items);
  }, [token]);
  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/v1/operations/skill-aliases", {
      method: "POST",
      headers: { "X-Admin-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ alias, canonical }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "登録に失敗しました");
      return;
    }
    setAlias("");
    setCanonical("");
    load();
  }

  async function remove(id: string) {
    if (!confirm("この辞書エントリを削除しますか？")) return;
    await fetch(`/api/v1/operations/skill-aliases/${id}`, {
      method: "DELETE",
      headers: { "X-Admin-Token": token },
    });
    load();
  }

  // LLM自動登録分の是正: 正規形だけを修正できる
  async function editCanonical(id: string, current: string) {
    const v = prompt("正規形を修正してください", current)?.trim();
    if (!v || v === current) return;
    await fetch(`/api/v1/operations/skill-aliases/${id}`, {
      method: "PUT",
      headers: { "X-Admin-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ canonical: v }),
    });
    load();
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <h2 className="mb-1 text-lg font-bold">用語辞書（同義語）</h2>
      <p className="mb-4 text-xs text-stone-500">
        スキル・工程・業種名の表記ゆれを正規形に引き当てます（例: 保険業務 → 保険）。
        マッチングの完全一致判定の前に適用されます。「〜業務」「〜経験」等の接尾辞は辞書がなくても自動で除去されます。
      </p>
      {error && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <form onSubmit={add} className="mb-4 flex items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-stone-500">表記（ゆれ）</label>
          <input value={alias} onChange={(e) => setAlias(e.target.value)} required placeholder="保険業務"
            className="rounded border border-stone-300 px-2 py-1.5 text-sm" />
        </div>
        <span className="pb-2 text-stone-400">→</span>
        <div>
          <label className="mb-1 block text-xs text-stone-500">正規形</label>
          <input value={canonical} onChange={(e) => setCanonical(e.target.value)} required placeholder="保険"
            className="rounded border border-stone-300 px-2 py-1.5 text-sm" />
        </div>
        <button className="rounded bg-orange-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-orange-800">
          登録
        </button>
      </form>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-stone-500">
          <tr>
            <th className="py-1.5">表記</th>
            <th className="py-1.5">正規形</th>
            <th className="py-1.5">登録元</th>
            <th className="py-1.5">登録日</th>
            <th className="py-1.5" />
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id} className="border-t border-stone-100">
              <td className="py-1.5 font-medium">{a.alias}</td>
              <td className="py-1.5">{a.canonical}</td>
              <td className="py-1.5 text-xs">
                {a.source === "MANUAL" ? (
                  <span className="text-stone-500">手動</span>
                ) : (
                  <span className="rounded bg-purple-50 px-1.5 py-0.5 text-purple-700">LLM自動</span>
                )}
              </td>
              <td className="py-1.5 text-xs text-stone-500">{new Date(a.createdAt).toLocaleDateString("ja-JP")}</td>
              <td className="py-1.5 text-right">
                <button onClick={() => editCanonical(a.id, a.canonical)} className="mr-3 text-xs text-orange-700 hover:underline">修正</button>
                <button onClick={() => remove(a.id)} className="text-xs text-red-600 hover:underline">削除</button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={5} className="py-6 text-center text-stone-400">辞書エントリはありません</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function ReportsSection({
  token,
  reports,
  reload,
}: {
  token: string;
  reports: AdminReport[];
  reload: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);

  async function post(path: string, body?: object) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "X-Admin-Token": token, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) await reload();
    else setError("操作に失敗しました");
  }

  return (
    <div>
        {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">通報対応（§24）</h2>
          {reports.length === 0 && <p className="text-sm text-stone-400">通報はありません</p>}
          <div className="space-y-2">
            {reports.map((r) => (
              <div key={r.id} className="rounded border border-stone-100 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    {r.category}
                    <span className="ml-2 text-xs font-normal text-stone-500">
                      通報元: {r.reporterCompanyName} ／ {new Date(r.createdAt).toLocaleString("ja-JP")}
                    </span>
                  </p>
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${
                      r.status === "OPEN" ? "bg-amber-50 text-amber-700"
                        : r.status === "REVIEWING" ? "bg-orange-50 text-orange-800"
                        : "bg-emerald-50 text-emerald-700"
                    }`}>
                      {r.status === "OPEN" ? "未対応" : r.status === "REVIEWING" ? "審査中" : "対応済み"}
                    </span>
                    {r.status === "OPEN" && (
                      <button
                        onClick={() => post(`/api/v1/operations/reports/${r.id}/status`, { status: "REVIEWING" })}
                        className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50"
                      >
                        審査開始
                      </button>
                    )}
                    {r.status !== "RESOLVED" && (
                      <button
                        onClick={() => post(`/api/v1/operations/reports/${r.id}/status`, { status: "RESOLVED" })}
                        className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50"
                      >
                        対応済みにする
                      </button>
                    )}
                  </div>
                </div>
                {r.targetRef && <p className="mt-1 text-xs text-stone-500">対象: {r.targetRef}</p>}
                <p className="mt-1 text-sm text-stone-600">{r.body}</p>
              </div>
            ))}
          </div>
        </section>
    </div>
  );
}

type AdminContract = {
  id: string;
  status: string;
  contractType: string;
  monthlyRateYen: number;
  startDate: string;
  endDate: string | null;
  workStartedAt: string | null;
  terminatedAt: string | null;
  demandCompanyName: string;
  supplyCompanyName: string;
  projectCode: string;
  projectName: string;
  engineerCode: string;
  engineerName: string;
  confirmedMonths: number;
  lastConfirmedMonth: string | null;
  totalConfirmedYen: number;
  totalFeeExTaxYen: number;
  chargedMonths: number;
  freeMonths: number;
};

const CONTRACT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "下書き",
  SIGNED_SUPPLY: "供給側署名済",
  SIGNED_DEMAND: "需要側署名済",
  EXECUTED: "成約（稼働前）",
  ACTIVE: "稼働中",
  CANCELLED: "キャンセル",
  TERMINATED: "終了",
  COMPLETED: "完了",
};

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

// 各契約の稼働状況・金額・手数料の監視
function ContractMonitorSection({ token }: { token: string }) {
  const [contracts, setContracts] = useState<AdminContract[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    fetch("/api/v1/operations/contracts", { headers: { "X-Admin-Token": token } })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        setContracts((await res.json()).items);
      })
      .catch(() => setError("契約一覧の取得に失敗しました"));
  }, [token]);

  const q = filter.trim().toLowerCase();
  const visible = contracts.filter(
    (c) =>
      (!statusFilter || c.status === statusFilter) &&
      (!q ||
        [c.demandCompanyName, c.supplyCompanyName, c.projectName, c.engineerName, c.engineerCode].some(
          (v) => v.toLowerCase().includes(q)
        ))
  );
  const active = contracts.filter((c) => c.status === "ACTIVE");
  const totalConfirmed = contracts.reduce((s, c) => s + c.totalConfirmedYen, 0);
  const totalFee = contracts.reduce((s, c) => s + c.totalFeeExTaxYen, 0);

  return (
    <section className="mb-8 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 font-bold">契約・手数料の監視（{contracts.length}件）</h2>
      <p className="mb-3 text-xs text-stone-500">
        全テナントの契約と、月次確認済みの稼働金額・プラットフォーム手数料を一覧します（2026-08-22の完全無料化以降、手数料は全稼働月0円で記録されます）。
      </p>
      {error && <p className="mb-2 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="mb-3 flex flex-wrap gap-3 text-xs">
        <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">稼働中 {active.length} 件</span>
        <span className="rounded bg-orange-50 px-2 py-1 text-orange-800">
          成約（稼働前） {contracts.filter((c) => c.status === "EXECUTED").length} 件
        </span>
        <span className="rounded bg-stone-100 px-2 py-1 text-stone-600">確認済み稼働額 累計 {yen(totalConfirmed)}</span>
        <span className="rounded bg-orange-50 px-2 py-1 text-orange-800">手数料（税抜） 累計 {yen(totalFee)}</span>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="絞り込み（企業名・案件名・人材）"
          className="w-72 rounded border border-stone-300 px-2 py-1.5 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border border-stone-300 px-2 py-1.5 text-sm"
        >
          <option value="">すべての状態</option>
          {Object.entries(CONTRACT_STATUS_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs text-stone-500">
            <tr>
              <th className="px-3 py-2">状態</th>
              <th className="px-3 py-2">案件（需要側）</th>
              <th className="px-3 py-2">人材（供給側）</th>
              <th className="px-3 py-2 text-right">月額（税抜）</th>
              <th className="px-3 py-2">稼働期間</th>
              <th className="px-3 py-2 text-right">確認済み稼働</th>
              <th className="px-3 py-2 text-right">手数料（税抜）</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <tr key={c.id} className="border-t border-stone-100 align-top">
                <td className="px-3 py-2 text-xs">
                  <span
                    className={`rounded px-1.5 py-0.5 ${
                      c.status === "ACTIVE"
                        ? "bg-emerald-50 text-emerald-700"
                        : c.status === "EXECUTED"
                          ? "bg-orange-50 text-orange-800"
                          : c.status === "CANCELLED" || c.status === "TERMINATED"
                            ? "bg-red-50 text-red-700"
                            : "bg-stone-100 text-stone-600"
                    }`}
                  >
                    {CONTRACT_STATUS_LABELS[c.status] ?? c.status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium">{c.projectName}</p>
                  <p className="text-xs text-stone-500">{c.demandCompanyName}</p>
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium">
                    {c.engineerCode} {c.engineerName}
                  </p>
                  <p className="text-xs text-stone-500">{c.supplyCompanyName}</p>
                </td>
                <td className="px-3 py-2 text-right">{yen(c.monthlyRateYen)}</td>
                <td className="px-3 py-2 text-xs">
                  {c.workStartedAt
                    ? `${new Date(c.workStartedAt).toLocaleDateString("ja-JP")} 〜`
                    : "稼働前"}
                  {c.endDate && ` ${new Date(c.endDate).toLocaleDateString("ja-JP")}`}
                  {c.terminatedAt && (
                    <span className="block text-red-600">
                      終了: {new Date(c.terminatedAt).toLocaleDateString("ja-JP")}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {c.confirmedMonths > 0 ? (
                    <>
                      <p>{yen(c.totalConfirmedYen)}</p>
                      <p className="text-xs text-stone-500">
                        {c.confirmedMonths}か月（〜{c.lastConfirmedMonth}）
                      </p>
                    </>
                  ) : (
                    <span className="text-xs text-stone-400">未確認</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {c.confirmedMonths > 0 ? (
                    <>
                      <p>{yen(c.totalFeeExTaxYen)}</p>
                      <p className="text-xs text-stone-500">
                        課金 {c.chargedMonths}/12
                        {c.freeMonths > 0 && `（無償 ${c.freeMonths}）`}
                      </p>
                    </>
                  ) : (
                    <span className="text-xs text-stone-400">-</span>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-xs text-stone-400">
                  {contracts.length === 0 ? "契約はまだありません" : "条件に一致する契約がありません"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type AdminEngineer = {
  id: string;
  code: string;
  name: string;
  companyName: string;
  publishStatus: string;
  availabilityRate: number;
  availableFrom: string | null;
  workStatus: "WORKING" | "CONTRACTED" | "STANDBY";
  assignment: {
    projectName: string;
    demandCompanyName: string;
    monthlyRateYen: number;
    workStartedAt: string | null;
    endDate: string | null;
  } | null;
};

// 人材の稼働状況の監視
function EngineerMonitorSection({ token }: { token: string }) {
  const [engineers, setEngineers] = useState<AdminEngineer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [workFilter, setWorkFilter] = useState("");

  useEffect(() => {
    fetch("/api/v1/operations/engineers", { headers: { "X-Admin-Token": token } })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        setEngineers((await res.json()).items);
      })
      .catch(() => setError("人材一覧の取得に失敗しました"));
  }, [token]);

  const q = filter.trim().toLowerCase();
  const visible = engineers.filter(
    (e) =>
      (!workFilter || e.workStatus === workFilter) &&
      (!q ||
        [e.name, e.code, e.companyName, e.assignment?.projectName ?? ""].some((v) =>
          v.toLowerCase().includes(q)
        ))
  );
  const count = (s: AdminEngineer["workStatus"]) => engineers.filter((e) => e.workStatus === s).length;

  return (
    <section className="mb-8 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 font-bold">人材稼働状況の監視（{engineers.length}名）</h2>
      <p className="mb-3 text-xs text-stone-500">
        全テナントの人材と稼働状態（契約から導出）を一覧します。削除済みの人材は含みません。
      </p>
      {error && <p className="mb-2 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="mb-3 flex flex-wrap gap-3 text-xs">
        <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">稼働中 {count("WORKING")} 名</span>
        <span className="rounded bg-orange-50 px-2 py-1 text-orange-800">成約（稼働前） {count("CONTRACTED")} 名</span>
        <span className="rounded bg-stone-100 px-2 py-1 text-stone-600">待機 {count("STANDBY")} 名</span>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="絞り込み（氏名・人材ID・企業名・案件名）"
          className="w-72 rounded border border-stone-300 px-2 py-1.5 text-sm"
        />
        <select
          value={workFilter}
          onChange={(e) => setWorkFilter(e.target.value)}
          className="rounded border border-stone-300 px-2 py-1.5 text-sm"
        >
          <option value="">すべての稼働状態</option>
          <option value="WORKING">稼働中</option>
          <option value="CONTRACTED">成約（稼働前）</option>
          <option value="STANDBY">待機</option>
        </select>
      </div>
      <div className="max-h-96 overflow-x-auto overflow-y-auto rounded border border-stone-100">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-stone-50 text-left text-xs text-stone-500">
            <tr>
              <th className="px-3 py-2">人材</th>
              <th className="px-3 py-2">所属企業</th>
              <th className="px-3 py-2">稼働状態</th>
              <th className="px-3 py-2">稼働先（案件／需要側）</th>
              <th className="px-3 py-2">稼働開始日</th>
              <th className="px-3 py-2">公開状態</th>
              <th className="px-3 py-2 text-right">稼働率</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => (
              <tr key={e.id} className="border-t border-stone-100">
                <td className="px-3 py-2 font-medium">
                  {e.code} {e.name}
                </td>
                <td className="px-3 py-2 text-xs text-stone-500">{e.companyName}</td>
                <td className="px-3 py-2 text-xs">
                  <span
                    className={`rounded px-1.5 py-0.5 ${
                      e.workStatus === "WORKING"
                        ? "bg-emerald-50 text-emerald-700"
                        : e.workStatus === "CONTRACTED"
                          ? "bg-orange-50 text-orange-800"
                          : "bg-stone-100 text-stone-600"
                    }`}
                  >
                    {e.workStatus === "WORKING" ? "稼働中" : e.workStatus === "CONTRACTED" ? "成約（稼働前）" : "待機"}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">
                  {e.assignment ? (
                    <>
                      <p>{e.assignment.projectName}</p>
                      <p className="text-stone-500">{e.assignment.demandCompanyName}</p>
                    </>
                  ) : (
                    <span className="text-stone-400">
                      {e.availableFrom
                        ? `${new Date(e.availableFrom).toLocaleDateString("ja-JP")} から稼働可能`
                        : "-"}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {e.assignment?.workStartedAt
                    ? new Date(e.assignment.workStartedAt).toLocaleDateString("ja-JP")
                    : "-"}
                </td>
                <td className="px-3 py-2 text-xs">
                  {e.publishStatus === "PUBLISHED" ? (
                    <span className="text-emerald-700">公開中</span>
                  ) : e.publishStatus === "DRAFT" ? (
                    "下書き"
                  ) : (
                    "非公開"
                  )}
                </td>
                <td className="px-3 py-2 text-right text-xs">{e.availabilityRate}%</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-xs text-stone-400">
                  {engineers.length === 0 ? "人材はまだ登録されていません" : "条件に一致する人材がいません"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type BroadcastMember = {
  id: string;
  name: string;
  email: string;
  status: string;
  companyId: string;
  companyName: string;
  companyStatus: string;
};

type BroadcastProspect = {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
};

// 宛先行: 担当者（テナント）と販促先（プロスペクト）を1つの表で扱う
type Recipient = {
  key: string; // "m:<id>" | "p:<id>"
  kind: "member" | "prospect";
  id: string;
  name: string;
  email: string;
  companyName: string;
  memberStatus?: string;
  companyStatus?: string;
};

// メール配信（営業PR・お知らせ）: 宛先を選択して一斉送信。200名ずつ分割して送信する。
// 販促先は企業CSVと同じフォーマットのCSVから取り込める
function MailBroadcastSection({ token }: { token: string }) {
  const [members, setMembers] = useState<BroadcastMember[]>([]);
  const [prospects, setProspects] = useState<BroadcastProspect[]>([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prospectFile, setProspectFile] = useState<File | null>(null);
  const [importingProspects, setImportingProspects] = useState(false);
  const [prospectMsg, setProspectMsg] = useState<string | null>(null);

  const loadRecipients = useCallback(async () => {
    const headers = { "X-Admin-Token": token };
    const [mRes, pRes] = await Promise.all([
      fetch("/api/v1/operations/members/all", { headers }),
      fetch("/api/v1/operations/prospects", { headers }),
    ]);
    if (!mRes.ok || !pRes.ok) throw new Error("load failed");
    setMembers((await mRes.json()).items);
    setProspects((await pRes.json()).items);
  }, [token]);

  useEffect(() => {
    loadRecipients().catch(() => setError("宛先一覧の取得に失敗しました"));
  }, [loadRecipients]);

  const recipients: Recipient[] = [
    ...members.map((m) => ({
      key: `m:${m.id}`,
      kind: "member" as const,
      id: m.id,
      name: m.name,
      email: m.email,
      companyName: m.companyName,
      memberStatus: m.status,
      companyStatus: m.companyStatus,
    })),
    ...prospects.map((p) => ({
      key: `p:${p.id}`,
      kind: "prospect" as const,
      id: p.id,
      name: p.contactName,
      email: p.email,
      companyName: p.companyName,
    })),
  ];
  const q = filter.trim().toLowerCase();
  const visible = q
    ? recipients.filter((r) =>
        [r.name, r.email, r.companyName].some((v) => v.toLowerCase().includes(q))
      )
    : recipients;

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectVisible(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of visible) {
        if (on) next.add(r.key);
        else next.delete(r.key);
      }
      return next;
    });
  }

  async function importProspectCsv() {
    if (!prospectFile) return;
    setError(null);
    setProspectMsg(null);
    setImportingProspects(true);
    try {
      const csv = await prospectFile.text();
      const res = await fetch("/api/v1/operations/prospects/import", {
        method: "POST",
        headers: { "X-Admin-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const b = await res.json().catch(() => null);
      if (res.ok) {
        const skipped = b.results.filter((r: { skipped?: boolean }) => r.skipped).length;
        const failed = b.results.filter((r: { ok: boolean }) => !r.ok).length;
        setProspectMsg(
          `販促先を ${b.created} 件登録しました${skipped ? ` ／ スキップ ${skipped} 行` : ""}${failed ? ` ／ 失敗 ${failed} 行` : ""}`
        );
        setProspectFile(null);
        await loadRecipients();
      } else {
        setError(b?.error?.message ?? "販促先の取込に失敗しました");
      }
    } finally {
      setImportingProspects(false);
    }
  }

  async function removeProspect(r: Recipient) {
    if (!window.confirm(`販促先 ${r.name}（${r.email}）を削除しますか？`)) return;
    setError(null);
    const res = await fetch(`/api/v1/operations/prospects/${r.id}`, {
      method: "DELETE",
      headers: { "X-Admin-Token": token },
    });
    if (res.ok) {
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(r.key);
        return next;
      });
      await loadRecipients();
    } else {
      setError("販促先の削除に失敗しました");
    }
  }

  async function send() {
    const keys = [...selected];
    if (keys.length === 0 || !subject.trim() || !body.trim()) return;
    if (
      !window.confirm(
        `選択した ${keys.length} 名にメールを配信しますか？\n件名: ${subject.trim()}\nこの操作は取り消せません。`
      )
    )
      return;
    setError(null);
    setResult(null);
    setSending(true);
    setProgress(0);
    let sent = 0;
    try {
      for (let i = 0; i < keys.length; i += 200) {
        const chunk = keys.slice(i, i + 200);
        const res = await fetch("/api/v1/operations/mail/broadcast", {
          method: "POST",
          headers: { "X-Admin-Token": token, "Content-Type": "application/json" },
          body: JSON.stringify({
            memberIds: chunk.filter((k) => k.startsWith("m:")).map((k) => k.slice(2)),
            prospectIds: chunk.filter((k) => k.startsWith("p:")).map((k) => k.slice(2)),
            subject: subject.trim(),
            body: body.trim(),
          }),
        });
        const b = await res.json().catch(() => null);
        if (!res.ok) {
          setError(`${b?.error?.message ?? "配信に失敗しました"}（${sent} 名まで配信済み）`);
          return;
        }
        sent += b.sent;
        setProgress(Math.min(i + 200, keys.length));
      }
      setResult(`${sent} 名に配信しました`);
      setSelected(new Set());
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mb-8 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 font-bold">メール配信（営業PR・お知らせ）</h2>
      <p className="mb-3 text-xs text-stone-500">
        宛先に選択した担当者・販促先へ同じ内容のメールを一斉送信します。同一メールアドレスへは1通のみ送ります。
        販促先は企業CSVと同じフォーマット（3列: 企業名, 担当者名, メールアドレス ／ 5列にも対応）の
        CSVから取り込めます（テナント登録はされず、配信先としてのみ使われます）。
      </p>
      {error && <p className="mb-2 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {result && <p className="mb-2 rounded bg-emerald-50 p-2 text-sm text-emerald-700">{result}</p>}
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded border border-stone-100 bg-stone-50 p-3">
        <span className="text-xs font-medium text-stone-600">販促先リスト取込（CSV）</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setProspectFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        <button
          onClick={importProspectCsv}
          disabled={!prospectFile || importingProspects}
          className="rounded bg-stone-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-40"
        >
          {importingProspects ? "取込中..." : "取り込む"}
        </button>
        {prospectMsg && <span className="text-xs text-emerald-700">{prospectMsg}</span>}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="絞り込み（氏名・メール・企業名）"
          className="w-72 rounded border border-stone-300 px-2 py-1.5 text-sm"
        />
        <button
          onClick={() => selectVisible(true)}
          className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50"
        >
          表示中を全選択
        </button>
        <button
          onClick={() => selectVisible(false)}
          className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50"
        >
          表示中を解除
        </button>
        <span className="text-xs text-stone-500">
          選択 {selected.size} 名 ／ 表示 {visible.length} 名 ／ 担当者 {members.length} 名・販促先 {prospects.length} 件
        </span>
      </div>
      <div className="mb-3 max-h-64 overflow-y-auto rounded border border-stone-100">
        <table className="w-full text-sm">
          <tbody>
            {visible.map((r) => (
              <tr key={r.key} className="border-t border-stone-100 first:border-t-0 hover:bg-stone-50">
                <td className="w-8 px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={selected.has(r.key)}
                    onChange={() => toggle(r.key)}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      r.kind === "prospect"
                        ? "bg-purple-50 text-purple-700"
                        : "bg-orange-50 text-orange-800"
                    }`}
                  >
                    {r.kind === "prospect" ? "販促先" : "担当者"}
                  </span>
                </td>
                <td className="px-2 py-1.5 font-medium">{r.name}</td>
                <td className="px-2 py-1.5 text-stone-500">{r.email}</td>
                <td className="px-2 py-1.5 text-xs text-stone-500">{r.companyName}</td>
                <td className="px-2 py-1.5 text-xs">
                  {r.kind === "member" && r.companyStatus !== "ACTIVE" && (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">未開通</span>
                  )}
                  {r.kind === "member" && r.memberStatus !== "ACTIVE" && (
                    <span className="ml-1 rounded bg-stone-100 px-1.5 py-0.5">停止中</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {r.kind === "prospect" && (
                    <button
                      onClick={() => removeProspect(r)}
                      className="rounded border border-red-300 px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50"
                    >
                      削除
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-xs text-stone-400">該当する宛先がいません</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="space-y-2">
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="件名"
          maxLength={200}
          className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="本文（テキストメール）"
          rows={8}
          maxLength={20000}
          className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
        />
        <button
          onClick={send}
          disabled={sending || selected.size === 0 || !subject.trim() || !body.trim()}
          className="rounded bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-40"
        >
          {sending
            ? `配信中... (${progress}/${selected.size})`
            : `選択した ${selected.size} 名に配信する`}
        </button>
      </div>
    </section>
  );
}

// 企業一覧の展開行: 担当者の一覧・修正・再招待・削除（運営権限）
function CompanyMembersPanel({ companyId, token }: { companyId: string; token: string }) {
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [issued, setIssued] = useState<{ id: string; password: string } | null>(null);

  const loadMembers = useCallback(async () => {
    const res = await fetch(`/api/v1/operations/companies/${companyId}/members`, {
      headers: { "X-Admin-Token": token },
    });
    if (res.ok) setMembers((await res.json()).items);
    else setError("担当者の取得に失敗しました");
  }, [companyId, token]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  async function save(id: string) {
    setError(null);
    const res = await fetch(`/api/v1/operations/members/${id}`, {
      method: "PUT",
      headers: { "X-Admin-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, email: editEmail }),
    });
    if (res.ok) {
      setEditId(null);
      await loadMembers();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "更新に失敗しました");
    }
  }

  async function mfaReset(m: AdminMember) {
    if (!window.confirm(`${m.name} さんの2要素認証をリセットしますか？（本人が再設定するまで2要素なしでログインできます）`)) return;
    const res = await fetch(`/api/v1/operations/members/${m.id}/mfa-reset`, { method: "POST", headers: { "X-Admin-Token": token } });
    if (!res.ok) setError("2要素認証のリセットに失敗しました");
  }

  async function reinvite(m: AdminMember) {
    if (!window.confirm(`${m.name} に個別の初期パスワードを再発行して招待メールを送りますか？`)) return;
    setError(null);
    const res = await fetch(`/api/v1/operations/members/${m.id}/reinvite`, {
      method: "POST",
      headers: { "X-Admin-Token": token },
    });
    if (res.ok) {
      const b = await res.json();
      setIssued({ id: m.id, password: b.initialPassword });
      await loadMembers();
    } else {
      setError("再招待に失敗しました");
    }
  }

  async function remove(m: AdminMember) {
    if (!window.confirm(`${m.name}（${m.email}）を削除しますか？（アカウントごと削除され、元に戻せません）`)) return;
    setError(null);
    const res = await fetch(`/api/v1/operations/members/${m.id}`, {
      method: "DELETE",
      headers: { "X-Admin-Token": token },
    });
    if (res.ok) await loadMembers();
    else setError("削除に失敗しました");
  }

  async function promote(m: AdminMember) {
    if (!window.confirm(`${m.name} を代表にしますか？（既存のロールは維持されます）`)) return;
    setError(null);
    const res = await fetch(`/api/v1/operations/members/${m.id}/promote-owner`, {
      method: "POST",
      headers: { "X-Admin-Token": token },
    });
    if (res.ok) await loadMembers();
    else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "代表昇格に失敗しました");
    }
  }

  return (
    <div className="text-sm">
      {error && <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      {members.length === 0 && !error && <p className="text-xs text-stone-400">担当者がいません</p>}
      <div className="space-y-1">
        {members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-2 rounded border border-stone-200 bg-white px-3 py-2">
            {editId === m.id ? (
              <>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-40 rounded border border-stone-300 px-2 py-1"
                />
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-64 rounded border border-stone-300 px-2 py-1"
                />
                <button onClick={() => save(m.id)} className="rounded bg-orange-700 px-2 py-1 text-xs text-white">
                  保存
                </button>
                <button onClick={() => setEditId(null)} className="rounded border border-stone-300 px-2 py-1 text-xs">
                  取消
                </button>
              </>
            ) : (
              <>
                <span className="font-medium">{m.name}</span>
                <span className="text-stone-500">{m.email}</span>
                {m.roles.includes("OWNER") && (
                  <span className="rounded bg-orange-50 px-2 py-0.5 text-xs text-orange-800">代表</span>
                )}
                <span className={`rounded px-2 py-0.5 text-xs ${m.passwordIssued ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                  {m.passwordIssued ? "パスワード発行済み" : "未発行"}
                </span>
                {m.status !== "ACTIVE" && (
                  <span className="rounded bg-stone-100 px-2 py-0.5 text-xs">停止中</span>
                )}
                {issued?.id === m.id && (
                  <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
                    初期パスワード: <code className="rounded bg-white px-1">{issued.password}</code>
                  </span>
                )}
                <span className="ml-auto flex gap-2">
                  <button
                    onClick={() => {
                      setEditId(m.id);
                      setEditName(m.name);
                      setEditEmail(m.email);
                    }}
                    className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100"
                  >
                    修正
                  </button>
                  {!m.roles.includes("OWNER") && (
                    <button onClick={() => promote(m)} className="rounded border border-orange-300 px-2 py-1 text-xs text-orange-800 hover:bg-orange-50">
                      代表にする
                    </button>
                  )}
                  <button onClick={() => reinvite(m)} className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100">
                    再招待
                  </button>
                  <button onClick={() => mfaReset(m)} className="rounded border border-stone-300 px-2 py-1 hover:bg-stone-50" title="2要素認証のリセット（サポート用）">

                    2要素リセット

                  </button>
                  <button onClick={() => remove(m)} className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                    削除
                  </button>
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- エラーログ（§33 監視）: LLM・取込・API・画面・メールのシステムエラー ----

const ERROR_SOURCE_LABELS: Record<string, string> = {
  LLM: "LLM",
  INGEST: "取込",
  API: "API",
  PAGE: "画面",
  MAIL: "メール",
  OTHER: "その他",
};

function ErrorLogSection({
  token,
  errors,
  reload,
}: {
  token: string;
  errors: AdminSystemError[];
  reload: () => Promise<void>;
}) {
  const [sourceFilter, setSourceFilter] = useState("");
  const [showAcked, setShowAcked] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function acknowledge(ids?: string[]) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/operations/errors/acknowledge", {
        method: "POST",
        headers: { "X-Admin-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify(ids ? { ids } : {}),
      });
      if (!res.ok) throw new Error();
      await reload();
    } catch {
      setError("確認済みへの更新に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  const unacked = errors.filter((e) => !e.acknowledgedAt);
  const visible = errors.filter(
    (e) => (showAcked || !e.acknowledgedAt) && (!sourceFilter || e.source === sourceFilter)
  );
  const countBySource = (src: string) => unacked.filter((e) => e.source === src).length;

  return (
    <section className="mb-8 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 font-bold">エラーログ（未確認 {unacked.length} 件）</h2>
      <p className="mb-3 text-xs text-stone-500">
        LLM 呼出し・取込・API・画面・メール送信のシステムエラーを全テナント横断で一覧します（直近300件）。
        書類側の問題（種別不一致・テキスト無し）は含みません。
        OPERATIONS_MAIL が設定されていれば発生時に運営へメール通知します（同一内容は30分以内は再通知しません）。
      </p>
      {error && <p className="mb-2 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="mb-3 flex flex-wrap gap-3 text-xs">
        {Object.entries(ERROR_SOURCE_LABELS).map(([src, label]) => (
          <button
            key={src}
            onClick={() => setSourceFilter(sourceFilter === src ? "" : src)}
            className={`rounded px-2 py-1 ${
              sourceFilter === src ? "bg-stone-800 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
            }`}
          >
            {label} {countBySource(src)} 件
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1 text-xs text-stone-600">
          <input type="checkbox" checked={showAcked} onChange={(e) => setShowAcked(e.target.checked)} />
          確認済みも表示
        </label>
        <button
          onClick={() => acknowledge()}
          disabled={busy || unacked.length === 0}
          className="rounded border border-stone-300 px-3 py-1 text-xs hover:bg-stone-50 disabled:opacity-50"
        >
          未確認をすべて確認済みにする
        </button>
        <button
          onClick={() => reload()}
          disabled={busy}
          className="rounded border border-stone-300 px-3 py-1 text-xs hover:bg-stone-50 disabled:opacity-50"
        >
          再読込
        </button>
      </div>
      {visible.length === 0 ? (
        <p className="rounded bg-stone-50 p-4 text-sm text-stone-500">該当するエラーはありません</p>
      ) : (
        <div className="max-h-[32rem] overflow-x-auto overflow-y-auto rounded border border-stone-100">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-stone-50 text-left text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2">発生時刻</th>
                <th className="px-3 py-2">分類</th>
                <th className="px-3 py-2">内容</th>
                <th className="px-3 py-2">企業／対象</th>
                <th className="px-3 py-2">通知</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => (
                <Fragment key={e.id}>
                  <tr className={`border-t border-stone-100 ${e.acknowledgedAt ? "text-stone-400" : ""}`}>
                    <td className="whitespace-nowrap px-3 py-2 align-top text-xs">
                      {new Date(e.createdAt).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          e.source === "LLM"
                            ? "bg-purple-50 text-purple-700"
                            : e.source === "API" || e.source === "PAGE"
                              ? "bg-red-50 text-red-700"
                              : "bg-stone-100 text-stone-600"
                        }`}
                      >
                        {ERROR_SOURCE_LABELS[e.source] ?? e.source}
                      </span>
                    </td>
                    <td className="max-w-md px-3 py-2 align-top">
                      <button
                        onClick={() => setOpenId(openId === e.id ? null : e.id)}
                        className="break-words text-left hover:underline"
                        title="クリックで詳細を表示"
                      >
                        {e.message}
                      </button>
                    </td>
                    <td className="px-3 py-2 align-top text-xs">
                      {e.tenantCompanyName && <div>{e.tenantCompanyName}</div>}
                      {(e.targetType || e.targetId) && (
                        <div className="text-stone-500">
                          {[e.targetType, e.targetId].filter(Boolean).join(" ")}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 align-top text-xs">
                      {e.notifiedAt ? "メール済" : "－"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 align-top text-xs">
                      {e.acknowledgedAt ? (
                        <span>確認済 {new Date(e.acknowledgedAt).toLocaleString("ja-JP")}</span>
                      ) : (
                        <button
                          onClick={() => acknowledge([e.id])}
                          disabled={busy}
                          className="rounded border border-stone-300 px-2 py-0.5 hover:bg-stone-50 disabled:opacity-50"
                        >
                          確認済みにする
                        </button>
                      )}
                    </td>
                  </tr>
                  {openId === e.id && (
                    <tr className="border-t border-stone-100 bg-stone-50">
                      <td colSpan={6} className="px-3 py-2">
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs text-stone-700">
                          {e.detail || "（詳細なし）"}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
