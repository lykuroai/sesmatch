"use client";

// 企業申込（§6.4）。申込後は運営審査を経てコンソール開通。
import { useState } from "react";
import Link from "next/link";

const input = "w-full rounded border border-slate-300 px-3 py-2 text-sm";
const label = "mb-1 block text-sm font-medium";

export default function ApplyPage() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [companyType, setCompanyType] = useState("CORPORATION");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/v1/companies/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName: f.get("companyName"),
        companyType: f.get("companyType"),
        corporateNumber: f.get("corporateNumber") || undefined,
        ownerName: f.get("ownerName"),
        email: f.get("email"),
        password: f.get("password"),
        agreedToTerms: f.get("agreedToTerms") === "on",
      }),
    });
    setLoading(false);
    if (res.ok) setDone(true);
    else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "申込に失敗しました");
    }
  }

  if (done) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="w-[28rem] rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="mb-3 text-xl font-bold">申込を受け付けました</h1>
          <p className="text-sm text-slate-600">
            運営審査ののち、企業コンソールが開通します。開通後、登録したメールアドレスとパスワードでログインしてください。
          </p>
          <Link href="/login" className="mt-6 inline-block text-sm text-blue-600 hover:underline">
            ログインページへ
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center py-10">
      <form onSubmit={submit} className="w-[28rem] rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-bold">企業申込</h1>
        <p className="mb-6 text-sm text-slate-500">
          契約主体は企業または個人事業者です（個人アカウントでの利用はできません）
        </p>
        {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <div className="space-y-4">
          <div>
            <label className={label}>企業形態</label>
            <select
              name="companyType"
              value={companyType}
              onChange={(e) => setCompanyType(e.target.value)}
              className={input}
            >
              <option value="CORPORATION">法人</option>
              <option value="SOLE_PROPRIETOR">個人事業者</option>
            </select>
          </div>
          <div>
            <label className={label}>{companyType === "CORPORATION" ? "企業名" : "屋号・事業者名"}</label>
            <input name="companyName" required className={input} />
          </div>
          {companyType === "CORPORATION" && (
            <div>
              <label className={label}>法人番号（13桁）</label>
              <input name="corporateNumber" required pattern="\d{13}" className={input} placeholder="1234567890123" />
            </div>
          )}
          <div>
            <label className={label}>代表者・企業オーナー氏名</label>
            <input name="ownerName" required className={input} />
          </div>
          <div>
            <label className={label}>メールアドレス</label>
            <input type="email" name="email" required className={input} />
          </div>
          <div>
            <label className={label}>パスワード（8文字以上）</label>
            <input type="password" name="password" required minLength={8} className={input} />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="agreedToTerms" required className="mt-0.5" />
            <span>
              利用規約・基本契約に同意します（案件・人材の再転載、無承認の再仲介、二社下以降の流通、
              直接取引の迂回は禁止されています）
            </span>
          </label>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "送信中..." : "申込む（運営審査へ）"}
        </button>
        <p className="mt-4 text-center text-xs text-slate-400">
          既にアカウントをお持ちの方は <Link href="/login" className="text-blue-600 hover:underline">ログイン</Link>
        </p>
      </form>
    </main>
  );
}
