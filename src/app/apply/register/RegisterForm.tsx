"use client";

// 企業申込の第2段階フォーム（/apply/register）。メールアドレスは第1段階で確認済みのため表示のみ（変更不可）。
// 残りの項目（企業形態・企業名・法人番号・所在地・代表者・パスワード・規約同意）を入力して申込を確定する
import { useState } from "react";
import Link from "next/link";
import { reportSignupConversion } from "@/lib/gtag";
import { inputClass as input, labelClass as label } from "@/app/apply/ApplyShell";

type ApplyPayload = Record<string, unknown>;

export default function RegisterForm({ token, email }: { token: string; email: string }) {
  const [error, setError] = useState<string | null>(null);
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const [done, setDone] = useState(false);
  const [companyType, setCompanyType] = useState("CORPORATION");
  const [loading, setLoading] = useState(false);
  // 類似企業の警告（社名 or 所在地の片方一致）。確認の上で再送すると申込が確定する
  const [warning, setWarning] = useState<{ matchedName: string; matchedField: string } | null>(null);
  const [pendingPayload, setPendingPayload] = useState<ApplyPayload | null>(null);

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
      const message: string = b?.error?.message ?? "申込に失敗しました";
      // 登録用URLの期限切れ・無効は再送の導線を出す
      setTokenInvalid(message.includes("登録用URL"));
      setError(message);
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
      password: f.get("password"),
      agreedToTerms: f.get("agreedToTerms") === "on",
      emailVerificationToken: token,
    });
  }

  // 警告を確認した上で申込を確定する
  async function confirmAndSubmit() {
    if (!pendingPayload) return;
    await post({ ...pendingPayload, duplicateWarningConfirmed: true });
  }

  if (done) {
    return (
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
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/10 sm:p-8">
      <h1 className="text-xl font-bold">企業登録</h1>
      <p className="mt-1 text-sm text-slate-500">
        メールアドレスの確認が完了しました。残りの項目を入力すると登録が完了し、すぐにログインできます。
      </p>
      <p className="mb-6 mt-2 text-xs text-slate-500">
        契約主体は企業または個人事業者です（個人アカウントでの利用はできません）。
        <Link href="/apply/rules" target="_blank" className="mx-0.5 font-medium text-blue-600 hover:underline">
          企業登録のルール・運用の流れ
        </Link>
      </p>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-2.5 text-sm text-red-700">
          <p>{error}</p>
          {tokenInvalid && (
            <Link href="/apply" className="mt-1 inline-block font-medium underline">
              申込画面からメールアドレスを再送信する
            </Link>
          )}
        </div>
      )}
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
          <label className={label}>メールアドレス（確認済み）</label>
          <input type="email" value={email} readOnly className={`${input} text-slate-500`} />
          <p className="mt-1 text-xs text-slate-500">
            別のアドレスで登録する場合は
            <Link href="/apply" className="mx-0.5 font-medium text-blue-600 hover:underline">申込画面</Link>
            からやり直してください。
          </p>
        </div>
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
        {loading ? "送信中..." : "登録を完了する"}
      </button>
      <p className="mt-4 text-center text-xs text-slate-500">
        既にアカウントをお持ちの方は <Link href="/login" className="font-medium text-blue-600 hover:underline">ログイン</Link>
      </p>
    </form>
  );
}
