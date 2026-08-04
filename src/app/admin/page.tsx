"use client";

// 運営コンソール（企業審査・通報対応）
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
  status: string;
  createdAt: string;
  _count: { members: number };
};

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

// 機能ごとの画面（メニューで切り替え）
const MENU = [
  { key: "review", label: "企業審査" },
  { key: "companies", label: "企業一覧" },
  { key: "contracts", label: "契約・手数料" },
  { key: "engineers", label: "人材稼働状況" },
  { key: "mail", label: "メール配信" },
  { key: "reports", label: "通報対応" },
] as const;
type MenuKey = (typeof MENU)[number]["key"];

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<PendingCompany[]>([]);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [allCompanies, setAllCompanies] = useState<AdminCompany[]>([]);
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
    const [cRes, rRes, aRes] = await Promise.all([
      fetch("/api/v1/operations/companies", { headers }),
      fetch("/api/v1/operations/reports", { headers }),
      fetch("/api/v1/operations/companies/all", { headers }),
    ]);
    if (!cRes.ok || !rRes.ok || !aRes.ok) throw new Error("認証エラー");
    setCompanies((await cRes.json()).items);
    setReports((await rRes.json()).items);
    setAllCompanies((await aRes.json()).items);
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
      <main className="flex min-h-screen items-center justify-center bg-slate-900">
        <form onSubmit={login} className="w-96 rounded-xl bg-white p-8 shadow">
          <h1 className="mb-1 text-xl font-bold">運営コンソール</h1>
          <p className="mb-6 text-sm text-slate-500">運営トークンを入力してください</p>
          {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="PLATFORM_ADMIN_TOKEN"
          />
          <button className="w-full rounded bg-slate-800 py-2 text-sm font-medium text-white hover:bg-slate-700">
            ログイン
          </button>
        </form>
      </main>
    );
  }

  const openReports = reports.filter((r) => r.status !== "RESOLVED").length;
  const badge = (key: MenuKey) =>
    key === "review" ? companies.length : key === "reports" ? openReports : 0;

  return (
    <main className="min-h-screen bg-slate-100 p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">運営コンソール</h1>
          <button
            onClick={() => {
              sessionStorage.removeItem("adminToken");
              setAuthed(false);
              setToken("");
            }}
            className="text-xs text-slate-500 underline"
          >
            ログアウト
          </button>
        </div>
        {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

        <div className="flex items-start gap-6">
          <aside className="w-48 shrink-0 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
            {MENU.map((m) => (
              <button
                key={m.key}
                onClick={() => selectTab(m.key)}
                className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm ${
                  tab === m.key ? "bg-slate-800 font-medium text-white" : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                <span>{m.label}</span>
                {badge(m.key) > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-xs ${
                      tab === m.key ? "bg-white text-slate-800" : "bg-amber-100 text-amber-700"
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
            {tab === "engineers" && <EngineerMonitorSection token={token} />}
            {tab === "mail" && <MailBroadcastSection token={token} />}
            {tab === "reports" && (
              <ReportsSection token={token} reports={reports} reload={() => load(token)} />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

// 企業審査
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
  const [approvePassword, setApprovePassword] = useState("");
  const [bulkApproving, setBulkApproving] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null); // 詳細を開いている企業

  function approveBody() {
    return approvePassword.trim() ? { initialPassword: approvePassword.trim() } : {};
  }

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
        `${co.name} を承認して開通しますか？\nパスワード未発行の担当者には初期パスワード付きの招待メールが送信されます。`
      )
    )
      return;
    setError(null);
    const res = await fetch(`/api/v1/operations/companies/${co.id}/approve`, {
      method: "POST",
      headers: { "X-Admin-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify(approveBody()),
    });
    if (res.ok) await reload();
    else setError("操作に失敗しました");
  }

  async function approveAll() {
    if (
      !window.confirm(
        `審査待ち ${companies.length} 社をすべて承認して開通しますか？\n承認した企業の担当者全員に初期パスワード付きの招待メールが送信されます。`
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
          body: JSON.stringify(approveBody()),
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

        <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">企業審査（審査待ち {companies.length}件）</h2>
          {companies.length === 0 && <p className="text-sm text-slate-400">審査待ちの企業はありません</p>}
          {companies.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded border border-slate-100 bg-slate-50 p-3">
              <p className="w-full text-xs text-slate-500">
                承認すると企業が有効になり、パスワード未発行の担当者（CSV取込分）へ初期パスワード付きの
                招待メールが送信されます。統一初期パスワード（8文字以上）を指定しない場合は企業ごとに自動生成します。
              </p>
              <input
                type="text"
                value={approvePassword}
                onChange={(e) => setApprovePassword(e.target.value)}
                placeholder="統一初期パスワード（空欄で自動生成）"
                className="w-72 rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
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
              <div key={co.id} className="rounded border border-slate-100 p-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{co.name}</p>
                    <p className="text-xs text-slate-500">
                      {co.companyType === "CORPORATION" ? "法人" : "個人事業者"}
                      ／ 申込: {new Date(co.createdAt).toLocaleString("ja-JP")}
                    </p>
                  </div>
                  <button
                    onClick={() => setOpenId(openId === co.id ? null : co.id)}
                    className="ml-3 shrink-0 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    {openId === co.id ? "閉じる" : "入力内容を確認"}
                  </button>
                </div>
                {openId === co.id && (
                  <div className="mt-3 rounded bg-slate-50 p-4">
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      <div>
                        <dt className="text-xs text-slate-500">企業名</dt>
                        <dd className="font-medium">{co.name}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">企業形態</dt>
                        <dd>{co.companyType === "CORPORATION" ? "法人" : "個人事業者"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">法人番号</dt>
                        <dd>{co.corporateNumber ?? "未入力"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">所在地</dt>
                        <dd>{co.address ?? "未入力"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">申込日時</dt>
                        <dd>{new Date(co.createdAt).toLocaleString("ja-JP")}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">申込者</dt>
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
  const [editCo, setEditCo] = useState({ name: "", companyType: "CORPORATION", corporateNumber: "" });

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
        <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-1 font-bold">企業一覧（{allCompanies.length}社）</h2>
          <p className="mb-3 text-xs text-slate-500">
            取込した不完全なデータ（種別・法人番号など）はここで修正できます。
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">企業名</th>
                  <th className="px-3 py-2">種別</th>
                  <th className="px-3 py-2">法人番号</th>
                  <th className="px-3 py-2">状態</th>
                  <th className="px-3 py-2">担当者数</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {allCompanies.map((co) => (
                  <Fragment key={co.id}>
                  {editCompanyId === co.id ? (
                    <tr className="border-t border-slate-100 bg-slate-50">
                      <td className="px-3 py-2">
                        <input
                          value={editCo.name}
                          onChange={(e) => setEditCo({ ...editCo, name: e.target.value })}
                          className="w-full rounded border border-slate-300 px-2 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={editCo.companyType}
                          onChange={(e) => setEditCo({ ...editCo, companyType: e.target.value })}
                          className="rounded border border-slate-300 px-2 py-1"
                        >
                          <option value="CORPORATION">法人</option>
                          <option value="SOLE_PROPRIETOR">個人事業者</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={editCo.corporateNumber}
                          onChange={(e) => setEditCo({ ...editCo, corporateNumber: e.target.value })}
                          placeholder="13桁（任意）"
                          className="w-36 rounded border border-slate-300 px-2 py-1"
                        />
                      </td>
                      <td className="px-3 py-2 text-xs">{co.status === "ACTIVE" ? "開通" : co.status === "APPLIED" ? "審査待ち" : "停止"}</td>
                      <td className="px-3 py-2 text-xs">{co._count.members}</td>
                      <td className="px-3 py-2 text-right text-xs">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => saveCompany(co.id)} className="rounded bg-blue-600 px-2 py-1 text-white">
                            保存
                          </button>
                          <button onClick={() => setEditCompanyId(null)} className="rounded border border-slate-300 px-2 py-1">
                            取消
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium">{co.name}</td>
                      <td className="px-3 py-2 text-xs">{co.companyType === "CORPORATION" ? "法人" : "個人事業者"}</td>
                      <td className="px-3 py-2 text-xs">{co.corporateNumber ?? <span className="text-amber-600">未登録</span>}</td>
                      <td className="px-3 py-2 text-xs">{co.status === "ACTIVE" ? "開通" : co.status === "APPLIED" ? "審査待ち" : "停止"}</td>
                      <td className="px-3 py-2 text-xs">{co._count.members}</td>
                      <td className="px-3 py-2 text-right text-xs">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => {
                              setEditCompanyId(co.id);
                              setEditCo({
                                name: co.name,
                                companyType: co.companyType,
                                corporateNumber: co.corporateNumber ?? "",
                              });
                            }}
                            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
                          >
                            修正
                          </button>
                          <button
                            onClick={() => setExpandedCompanyId(expandedCompanyId === co.id ? null : co.id)}
                            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
                          >
                            {expandedCompanyId === co.id ? "担当者を閉じる" : "担当者"}
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
                  {expandedCompanyId === co.id && (
                    <tr className="bg-slate-50">
                      <td colSpan={6} className="px-3 py-3">
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

// 通報対応
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
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">通報対応（§24）</h2>
          {reports.length === 0 && <p className="text-sm text-slate-400">通報はありません</p>}
          <div className="space-y-2">
            {reports.map((r) => (
              <div key={r.id} className="rounded border border-slate-100 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    {r.category}
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      通報元: {r.reporterCompanyName} ／ {new Date(r.createdAt).toLocaleString("ja-JP")}
                    </span>
                  </p>
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${
                      r.status === "OPEN" ? "bg-amber-50 text-amber-700"
                        : r.status === "REVIEWING" ? "bg-blue-50 text-blue-700"
                        : "bg-emerald-50 text-emerald-700"
                    }`}>
                      {r.status === "OPEN" ? "未対応" : r.status === "REVIEWING" ? "審査中" : "対応済み"}
                    </span>
                    {r.status === "OPEN" && (
                      <button
                        onClick={() => post(`/api/v1/operations/reports/${r.id}/status`, { status: "REVIEWING" })}
                        className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
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
                {r.targetRef && <p className="mt-1 text-xs text-slate-500">対象: {r.targetRef}</p>}
                <p className="mt-1 text-sm text-slate-600">{r.body}</p>
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
    <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 font-bold">契約・手数料の監視（{contracts.length}件）</h2>
      <p className="mb-3 text-xs text-slate-500">
        全テナントの契約と、月次確認済みの稼働金額・プラットフォーム手数料（3%・最大12稼働月）を一覧します。
      </p>
      {error && <p className="mb-2 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="mb-3 flex flex-wrap gap-3 text-xs">
        <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">稼働中 {active.length} 件</span>
        <span className="rounded bg-blue-50 px-2 py-1 text-blue-700">
          成約（稼働前） {contracts.filter((c) => c.status === "EXECUTED").length} 件
        </span>
        <span className="rounded bg-slate-100 px-2 py-1 text-slate-600">確認済み稼働額 累計 {yen(totalConfirmed)}</span>
        <span className="rounded bg-indigo-50 px-2 py-1 text-indigo-700">手数料（税抜） 累計 {yen(totalFee)}</span>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="絞り込み（企業名・案件名・人材）"
          className="w-72 rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
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
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
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
              <tr key={c.id} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2 text-xs">
                  <span
                    className={`rounded px-1.5 py-0.5 ${
                      c.status === "ACTIVE"
                        ? "bg-emerald-50 text-emerald-700"
                        : c.status === "EXECUTED"
                          ? "bg-blue-50 text-blue-700"
                          : c.status === "CANCELLED" || c.status === "TERMINATED"
                            ? "bg-red-50 text-red-700"
                            : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {CONTRACT_STATUS_LABELS[c.status] ?? c.status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium">{c.projectName}</p>
                  <p className="text-xs text-slate-500">{c.demandCompanyName}</p>
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium">
                    {c.engineerCode} {c.engineerName}
                  </p>
                  <p className="text-xs text-slate-500">{c.supplyCompanyName}</p>
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
                      <p className="text-xs text-slate-500">
                        {c.confirmedMonths}か月（〜{c.lastConfirmedMonth}）
                      </p>
                    </>
                  ) : (
                    <span className="text-xs text-slate-400">未確認</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {c.confirmedMonths > 0 ? (
                    <>
                      <p>{yen(c.totalFeeExTaxYen)}</p>
                      <p className="text-xs text-slate-500">
                        課金 {c.chargedMonths}/12
                        {c.freeMonths > 0 && `（無償 ${c.freeMonths}）`}
                      </p>
                    </>
                  ) : (
                    <span className="text-xs text-slate-400">-</span>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-xs text-slate-400">
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
    <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 font-bold">人材稼働状況の監視（{engineers.length}名）</h2>
      <p className="mb-3 text-xs text-slate-500">
        全テナントの人材と稼働状態（契約から導出）を一覧します。削除済みの人材は含みません。
      </p>
      {error && <p className="mb-2 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="mb-3 flex flex-wrap gap-3 text-xs">
        <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">稼働中 {count("WORKING")} 名</span>
        <span className="rounded bg-blue-50 px-2 py-1 text-blue-700">成約（稼働前） {count("CONTRACTED")} 名</span>
        <span className="rounded bg-slate-100 px-2 py-1 text-slate-600">待機 {count("STANDBY")} 名</span>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="絞り込み（氏名・人材ID・企業名・案件名）"
          className="w-72 rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
        <select
          value={workFilter}
          onChange={(e) => setWorkFilter(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="">すべての稼働状態</option>
          <option value="WORKING">稼働中</option>
          <option value="CONTRACTED">成約（稼働前）</option>
          <option value="STANDBY">待機</option>
        </select>
      </div>
      <div className="max-h-96 overflow-x-auto overflow-y-auto rounded border border-slate-100">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
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
              <tr key={e.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">
                  {e.code} {e.name}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">{e.companyName}</td>
                <td className="px-3 py-2 text-xs">
                  <span
                    className={`rounded px-1.5 py-0.5 ${
                      e.workStatus === "WORKING"
                        ? "bg-emerald-50 text-emerald-700"
                        : e.workStatus === "CONTRACTED"
                          ? "bg-blue-50 text-blue-700"
                          : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {e.workStatus === "WORKING" ? "稼働中" : e.workStatus === "CONTRACTED" ? "成約（稼働前）" : "待機"}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">
                  {e.assignment ? (
                    <>
                      <p>{e.assignment.projectName}</p>
                      <p className="text-slate-500">{e.assignment.demandCompanyName}</p>
                    </>
                  ) : (
                    <span className="text-slate-400">
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
                <td colSpan={7} className="px-3 py-4 text-center text-xs text-slate-400">
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
    <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 font-bold">メール配信（営業PR・お知らせ）</h2>
      <p className="mb-3 text-xs text-slate-500">
        宛先に選択した担当者・販促先へ同じ内容のメールを一斉送信します。同一メールアドレスへは1通のみ送ります。
        販促先は企業CSVと同じフォーマット（3列: 企業名, 担当者名, メールアドレス ／ 5列にも対応）の
        CSVから取り込めます（テナント登録はされず、配信先としてのみ使われます）。
      </p>
      {error && <p className="mb-2 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {result && <p className="mb-2 rounded bg-emerald-50 p-2 text-sm text-emerald-700">{result}</p>}
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded border border-slate-100 bg-slate-50 p-3">
        <span className="text-xs font-medium text-slate-600">販促先リスト取込（CSV）</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setProspectFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        <button
          onClick={importProspectCsv}
          disabled={!prospectFile || importingProspects}
          className="rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
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
          className="w-72 rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
        <button
          onClick={() => selectVisible(true)}
          className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
        >
          表示中を全選択
        </button>
        <button
          onClick={() => selectVisible(false)}
          className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
        >
          表示中を解除
        </button>
        <span className="text-xs text-slate-500">
          選択 {selected.size} 名 ／ 表示 {visible.length} 名 ／ 担当者 {members.length} 名・販促先 {prospects.length} 件
        </span>
      </div>
      <div className="mb-3 max-h-64 overflow-y-auto rounded border border-slate-100">
        <table className="w-full text-sm">
          <tbody>
            {visible.map((r) => (
              <tr key={r.key} className="border-t border-slate-100 first:border-t-0 hover:bg-slate-50">
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
                        : "bg-sky-50 text-sky-700"
                    }`}
                  >
                    {r.kind === "prospect" ? "販促先" : "担当者"}
                  </span>
                </td>
                <td className="px-2 py-1.5 font-medium">{r.name}</td>
                <td className="px-2 py-1.5 text-slate-500">{r.email}</td>
                <td className="px-2 py-1.5 text-xs text-slate-500">{r.companyName}</td>
                <td className="px-2 py-1.5 text-xs">
                  {r.kind === "member" && r.companyStatus !== "ACTIVE" && (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">未開通</span>
                  )}
                  {r.kind === "member" && r.memberStatus !== "ACTIVE" && (
                    <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5">停止中</span>
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
                <td className="px-3 py-3 text-xs text-slate-400">該当する宛先がいません</td>
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
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="本文（テキストメール）"
          rows={8}
          maxLength={20000}
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          onClick={send}
          disabled={sending || selected.size === 0 || !subject.trim() || !body.trim()}
          className="rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
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
    if (!window.confirm(`${m.name} を企業オーナーにしますか？（既存のロールは維持されます）`)) return;
    setError(null);
    const res = await fetch(`/api/v1/operations/members/${m.id}/promote-owner`, {
      method: "POST",
      headers: { "X-Admin-Token": token },
    });
    if (res.ok) await loadMembers();
    else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "オーナー昇格に失敗しました");
    }
  }

  return (
    <div className="text-sm">
      {error && <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      {members.length === 0 && !error && <p className="text-xs text-slate-400">担当者がいません</p>}
      <div className="space-y-1">
        {members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
            {editId === m.id ? (
              <>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-40 rounded border border-slate-300 px-2 py-1"
                />
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-64 rounded border border-slate-300 px-2 py-1"
                />
                <button onClick={() => save(m.id)} className="rounded bg-blue-600 px-2 py-1 text-xs text-white">
                  保存
                </button>
                <button onClick={() => setEditId(null)} className="rounded border border-slate-300 px-2 py-1 text-xs">
                  取消
                </button>
              </>
            ) : (
              <>
                <span className="font-medium">{m.name}</span>
                <span className="text-slate-500">{m.email}</span>
                {m.roles.includes("OWNER") && (
                  <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">オーナー</span>
                )}
                <span className={`rounded px-2 py-0.5 text-xs ${m.passwordIssued ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                  {m.passwordIssued ? "パスワード発行済み" : "未発行"}
                </span>
                {m.status !== "ACTIVE" && (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">停止中</span>
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
                    className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                  >
                    修正
                  </button>
                  {!m.roles.includes("OWNER") && (
                    <button onClick={() => promote(m)} className="rounded border border-indigo-300 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50">
                      オーナーにする
                    </button>
                  )}
                  <button onClick={() => reinvite(m)} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100">
                    再招待
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
