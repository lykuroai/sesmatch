"use client";

// 運営コンソール（企業審査・通報対応）
// 認証は X-Admin-Token（.env の PLATFORM_ADMIN_TOKEN）。企業コンソールとは独立。
import { Fragment, useCallback, useEffect, useState } from "react";

type PendingCompany = {
  id: string;
  name: string;
  companyType: string;
  corporateNumber: string | null;
  createdAt: string;
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

type ImportResult = {
  created: number;
  initialPassword: string;
  results: { row: number; companyName: string; ok: boolean; skipped?: boolean; message?: string }[];
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

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<PendingCompany[]>([]);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [allCompanies, setAllCompanies] = useState<AdminCompany[]>([]);
  const [editCompanyId, setEditCompanyId] = useState<string | null>(null);
  const [expandedCompanyId, setExpandedCompanyId] = useState<string | null>(null);
  const [editCo, setEditCo] = useState({ name: "", companyType: "CORPORATION", corporateNumber: "" });
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importPassword, setImportPassword] = useState("");

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

  async function saveCompany(id: string) {
    setError(null);
    const res = await fetch(`/api/v1/operations/companies/${id}`, {
      method: "PUT",
      headers: { "X-Admin-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify(editCo),
    });
    if (res.ok) {
      setEditCompanyId(null);
      await load(token);
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "企業情報の更新に失敗しました");
    }
  }

  async function importCsv() {
    if (!importFile) return;
    setError(null);
    setImportResult(null);
    setImporting(true);
    try {
      const csv = await importFile.text();
      const res = await fetch("/api/v1/operations/companies/import", {
        method: "POST",
        headers: { "X-Admin-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify(
          importPassword.trim() ? { csv, password: importPassword.trim() } : { csv }
        ),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        setImportResult(body);
        setImportFile(null);
        await load(token);
      } else {
        setError(body?.error?.message ?? "取込に失敗しました");
      }
    } finally {
      setImporting(false);
    }
  }

  async function post(path: string, body?: object) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "X-Admin-Token": token, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) await load(token);
    else setError("操作に失敗しました");
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

  return (
    <main className="min-h-screen bg-slate-100 p-8">
      <div className="mx-auto max-w-4xl">
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

        <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">企業審査（審査待ち {companies.length}件）</h2>
          {companies.length === 0 && <p className="text-sm text-slate-400">審査待ちの企業はありません</p>}
          <div className="space-y-2">
            {companies.map((co) => (
              <div key={co.id} className="flex items-center justify-between rounded border border-slate-100 p-3">
                <div>
                  <p className="text-sm font-medium">{co.name}</p>
                  <p className="text-xs text-slate-500">
                    {co.companyType === "CORPORATION" ? `法人（法人番号: ${co.corporateNumber ?? "-"}）` : "個人事業者"}
                    ／ 申込: {new Date(co.createdAt).toLocaleString("ja-JP")}
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (window.confirm(`${co.name} を承認して開通しますか？`))
                      post(`/api/v1/operations/companies/${co.id}/approve`);
                  }}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  承認して開通
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-1 font-bold">企業リスト取込（CSV アップロード）</h2>
          <p className="mb-3 text-xs text-slate-500">
            ヘッダ行の列名で自動判定します。3列（企業名, 担当者名, メールアドレス）の不完全なリストも取込可能で、
            種別・法人番号は下の企業一覧から後で修正できます。5列（企業名, 種別, 法人番号, オーナー名, メールアドレス）にも対応。
            取込した企業は審査済みとして即時開通し、全員に統一の初期パスワード（下の入力欄。空欄なら自動生成）を
            設定して、初期パスワードを記載した招待メールを送ります。
            取込した担当者は全員オーナー・管理者権限になり、同名の企業が既にある場合は新規作成せずその企業へ追加します。
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
            <input
              value={importPassword}
              onChange={(e) => setImportPassword(e.target.value)}
              placeholder="統一初期パスワード（空欄で自動生成）"
              className="w-72 rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
            <button
              onClick={importCsv}
              disabled={!importFile || importing}
              className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
            >
              {importing ? "取込中..." : "取り込む"}
            </button>
          </div>
          {importResult && (
            <div className="mt-3 rounded border border-slate-100 bg-slate-50 p-3 text-sm">
              <p className="font-medium">
                {importResult.created} 社を登録しました（統一初期パスワード:{" "}
                <code className="rounded bg-white px-1">{importResult.initialPassword}</code> ／ この画面でのみ表示）
                {importResult.results.some((r) => r.skipped) &&
                  ` ／ スキップ ${importResult.results.filter((r) => r.skipped).length} 行`}
                {importResult.results.some((r) => !r.ok) &&
                  ` ／ 失敗 ${importResult.results.filter((r) => !r.ok).length} 行`}
              </p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {importResult.results.map((r) => (
                  <li key={r.row} className={!r.ok ? "text-red-600" : r.skipped ? "text-slate-400" : "text-emerald-700"}>
                    {r.row}行目 {r.companyName || "（企業名なし）"}: {r.ok ? (r.message ?? "登録済み") : r.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

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
    </main>
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
