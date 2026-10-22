"use client";

// 企業申込（§6.4）。自動審査（メール確認・重複チェック）を通過すると即時にコンソール開通。
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { reportApplyReachConversion, reportSignupConversion } from "@/lib/gtag";
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";

// 入力欄・ラベルの見た目はログイン画面に合わせる
const input =
  "w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20";
const label = "mb-1 block text-sm font-medium text-slate-700";

// 公開ページ共通の外枠（ヘッダー・淡いグラデーション背景・フッター）
function ApplyShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <PublicHeader showApply={false} />
      <section className="relative overflow-hidden bg-gradient-to-b from-sky-50 via-white to-white">
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-blue-200/40 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -right-20 top-40 h-96 w-96 rounded-full bg-emerald-200/40 blur-3xl" />
        <div className="relative mx-auto max-w-md px-4 py-10 lg:py-16">{children}</div>
      </section>
      <PublicFooter />
    </main>
  );
}

type ApplyPayload = Record<string, unknown>;

export default function ApplyPage() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [companyType, setCompanyType] = useState("CORPORATION");
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  // 類似企業の警告（社名 or 所在地の片方一致）。確認の上で再送すると申込が確定する
  const [warning, setWarning] = useState<{ matchedName: string; matchedField: string } | null>(null);
  const [pendingPayload, setPendingPayload] = useState<ApplyPayload | null>(null);

  // 「申し込み到達」を画面表示時に1回送信（開発時の Strict Mode による effect 二重実行も1回に抑える）
  const reachReported = useRef(false);
  useEffect(() => {
    if (reachReported.current) return;
    reachReported.current = true;
    reportApplyReachConversion();
  }, []);

  // 代表メールへ確認コードを送付する
  async function sendCode() {
    if (!email.trim()) {
      setError("メールアドレスを入力してから確認コードを送信してください");
      return;
    }
    setSendingCode(true);
    setError(null);
    const res = await fetch("/api/v1/companies/applications/email-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    setSendingCode(false);
    if (res.ok) setCodeSent(true);
    else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "確認コードの送信に失敗しました");
    }
  }

  async function post(payload: ApplyPayload) {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/v1/companies/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setLoading(false);
    const b = await res.json().catch(() => null);
    if (res.ok && b?.duplicateWarning) {
      // 類似企業あり → 警告を表示し、確認の上で再送できるよう入力内容を保持する
      setWarning(b.duplicateWarning);
      setPendingPayload(payload);
    } else if (res.ok) {
      // 企業登録完了を送信（GTM 側で GA4 の sign_up と Google 広告「申し込み登録完了」コンバージョンを発火）
      reportSignupConversion();
      setDone(true);
    } else {
      setError(b?.error?.message ?? "申込に失敗しました");
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setWarning(null);
    setPendingPayload(null);
    const f = new FormData(e.currentTarget);
    // パスワードの打ち間違い防止: 確認欄と一致しなければ送信しない
    if (f.get("password") !== f.get("passwordConfirm")) {
      const confirmInput = e.currentTarget.elements.namedItem("passwordConfirm") as HTMLInputElement | null;
      confirmInput?.setCustomValidity("パスワードと確認用パスワードが一致しません");
      confirmInput?.reportValidity();
      setError("パスワードと確認用パスワードが一致しません");
      return;
    }
    setError(null);
    await post({
      companyName: f.get("companyName"),
      companyType: f.get("companyType"),
      corporateNumber: f.get("corporateNumber") || undefined,
      address: f.get("address"),
      ownerName: f.get("ownerName"),
      email: f.get("email"),
      password: f.get("password"),
      agreedToTerms: f.get("agreedToTerms") === "on",
      emailVerificationCode: f.get("emailVerificationCode"),
    });
  }

  // 警告を確認した上で申込を確定する
  async function confirmAndSubmit() {
    if (!pendingPayload) return;
    await post({ ...pendingPayload, duplicateWarningConfirmed: true });
  }

  if (done) {
    return (
      <ApplyShell>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-900/10">
          <h1 className="mb-3 text-xl font-bold">企業登録が完了しました</h1>
          <p className="text-sm text-slate-600">
            企業コンソールが開通しました。登録したメールアドレスとパスワードでログインしてご利用ください。
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block w-full rounded-full bg-slate-900 py-3 text-sm font-bold text-white transition hover:bg-slate-800"
          >
            ログインページへ
          </Link>
        </div>
      </ApplyShell>
    );
  }

  return (
    <ApplyShell>
      <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/10 sm:p-8">
        <h1 className="text-xl font-bold">企業申込</h1>
        <p className="mt-1 text-sm text-slate-500">
          契約主体は企業または個人事業者です（個人アカウントでの利用はできません）
        </p>
        <p className="mb-6 mt-2 text-xs text-slate-500">
          申込の前に
          <Link href="/apply/rules" target="_blank" className="mx-0.5 font-medium text-blue-600 hover:underline">
            企業登録のルール・運用の流れ
          </Link>
          をご確認ください。
        </p>
        {error && <p className="mb-4 rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{error}</p>}
        {warning && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">類似する企業が既に登録されています</p>
            <p className="mt-1">
              {warning.matchedField === "address"
                ? `同じ所在地の企業（${warning.matchedName}）が登録済みです。`
                : `同名または類似名の企業（${warning.matchedName}）が登録済みです。`}
              既存企業の担当者として参加する場合は、そのまま申込まず既存企業の代表から招待を受けてください。
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={confirmAndSubmit}
                disabled={loading}
                className="rounded-full bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {loading ? "送信中..." : "別企業として申込む"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setWarning(null);
                  setPendingPayload(null);
                }}
                className="rounded-full border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
              >
                入力を修正する
              </button>
            </div>
          </div>
        )}
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
              <label className={label}>法人番号（13桁・任意）</label>
              <input name="corporateNumber" pattern="\d{13}" className={input} placeholder="1234567890123" />
            </div>
          )}
          <div>
            <label className={label}>所在地（必須・都道府県から）</label>
            <input name="address" required className={input} placeholder="例: 東京都台東区上野1-1-1" />
          </div>
          <div>
            <label className={label}>代表者氏名</label>
            <input name="ownerName" required className={input} />
          </div>
          <div>
            <label className={label}>メールアドレス</label>
            <div className="flex gap-2">
              <input
                type="email"
                name="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={input}
              />
              <button
                type="button"
                onClick={sendCode}
                disabled={sendingCode}
                className="shrink-0 rounded-lg border border-blue-600 bg-white px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
              >
                {sendingCode ? "送信中..." : codeSent ? "コード再送" : "確認コード送信"}
              </button>
            </div>
            {codeSent && (
              <p className="mt-1 text-xs text-emerald-700">
                確認コードを送信しました。メールを確認して下に入力してください（15分有効）
              </p>
            )}
          </div>
          <div>
            <label className={label}>メール確認コード（6桁）</label>
            <input
              name="emailVerificationCode"
              required
              pattern="\d{6}"
              maxLength={6}
              className={input}
              placeholder="メールで届いた6桁の数字"
            />
          </div>
          <div>
            <label className={label}>パスワード（8文字以上）</label>
            <input type="password" name="password" required minLength={8} autoComplete="new-password" className={input} />
          </div>
          <div>
            <label className={label}>パスワード（確認用）</label>
            <input
              type="password"
              name="passwordConfirm"
              required
              minLength={8}
              autoComplete="new-password"
              onChange={(ev) => ev.currentTarget.setCustomValidity("")}
              className={input}
              placeholder="同じパスワードをもう一度入力"
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="agreedToTerms" required className="mt-0.5" />
            <span>
              <Link href="/terms" target="_blank" className="text-blue-600 hover:underline">利用規約</Link>・
              <Link href="/agreement" target="_blank" className="text-blue-600 hover:underline">基本契約</Link>・
              <Link href="/privacy-policy" target="_blank" className="text-blue-600 hover:underline">プライバシーポリシー</Link>
              に同意します（案件・人材の再転載、無承認の再仲介、二社下以降の流通、
              直接取引の迂回は禁止されています）
            </span>
          </label>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded-full bg-blue-600 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/30 transition hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "送信中..." : "申込む（登録を完了する）"}
        </button>
        <p className="mt-4 text-center text-xs text-slate-500">
          既にアカウントをお持ちの方は <Link href="/login" className="font-medium text-blue-600 hover:underline">ログイン</Link>
        </p>
      </form>
    </ApplyShell>
  );
}
