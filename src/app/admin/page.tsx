"use client";

// 運営コンソール（企業審査・通報対応）
// 認証は X-Admin-Token（.env の PLATFORM_ADMIN_TOKEN）。企業コンソールとは独立。
import { useCallback, useEffect, useState } from "react";

type PendingCompany = {
  id: string;
  name: string;
  companyType: string;
  corporateNumber: string | null;
  createdAt: string;
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

  const load = useCallback(async (t: string) => {
    const headers = { "X-Admin-Token": t };
    const [cRes, rRes] = await Promise.all([
      fetch("/api/v1/operations/companies", { headers }),
      fetch("/api/v1/operations/reports", { headers }),
    ]);
    if (!cRes.ok || !rRes.ok) throw new Error("認証エラー");
    setCompanies((await cRes.json()).items);
    setReports((await rRes.json()).items);
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
