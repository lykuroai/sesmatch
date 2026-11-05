"use client";

// 企業申込の第1段階（§6.4.1、2026-11-04 変更）: メールアドレスのみ入力 → 登録用URL（24時間有効）をメールで送る。
// 企業情報・代表者・パスワードは URL を開いた /apply/register で入力する（第2段階）
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { reportApplyReachConversion } from "@/lib/gtag";
import ApplyShell, { inputClass, labelClass } from "@/app/apply/ApplyShell";

export default function ApplyPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  // 「申し込み到達」を画面表示時に1回送信（開発時の Strict Mode による effect 二重実行も1回に抑える）
  const reachReported = useRef(false);
  useEffect(() => {
    if (reachReported.current) return;
    reachReported.current = true;
    reportApplyReachConversion();
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    setLoading(true);
    setError(null);
    const res = await fetch("/api/v1/companies/applications/email-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: value }),
    });
    setLoading(false);
    if (res.ok) {
      setSentTo(value);
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "登録用URLの送信に失敗しました");
    }
  }

  if (sentTo) {
    return (
      <ApplyShell>
        <div className="rounded-2xl border border-stone-200 bg-white p-8 shadow-xl shadow-stone-900/10">
          <h1 className="mb-3 text-xl font-bold">登録用URLをメールで送信しました</h1>
          <p className="text-sm text-stone-600">
            <span className="font-medium text-stone-900">{sentTo}</span> 宛に登録用URLを送りました。
            メールに記載の URL を開いて、企業情報・代表者・パスワードを入力すると登録が完了します。
          </p>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-stone-500">
            <li>URL の有効期限は 24 時間です。</li>
            <li>届かない場合は迷惑メールフォルダをご確認のうえ、下のボタンから再送信してください。</li>
          </ul>
          <button
            type="button"
            onClick={() => setSentTo(null)}
            className="mt-6 w-full rounded-full border border-stone-300 py-3 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
          >
            メールアドレスを入力し直す・再送信する
          </button>
        </div>
      </ApplyShell>
    );
  }

  return (
    <ApplyShell>
      <form onSubmit={submit} className="rounded-2xl border border-stone-200 bg-white p-6 shadow-xl shadow-stone-900/10 sm:p-8">
        <h1 className="text-xl font-bold">企業申込</h1>
        <p className="mt-1 text-sm text-stone-500">
          まずメールアドレスだけ入力してください。登録用URLをお送りします。
        </p>
        <p className="mb-6 mt-2 text-xs text-stone-500">
          契約主体は企業または個人事業者です（個人アカウントでの利用はできません）。申込の前に
          <Link href="/apply/rules" target="_blank" className="mx-0.5 font-medium text-orange-700 hover:underline">
            企業登録のルール・運用の流れ
          </Link>
          をご確認ください。
        </p>
        {error && <p className="mb-4 rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{error}</p>}
        <div>
          <label className={labelClass} htmlFor="apply-email">代表メールアドレス</label>
          <input
            id="apply-email"
            type="email"
            name="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="例: info@example.co.jp"
          />
          <p className="mt-1 text-xs text-stone-500">このアドレスが代表（企業オーナー）のログインIDになります。</p>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded-full bg-orange-700 py-3 text-sm font-bold text-white shadow-lg shadow-orange-700/30 transition hover:bg-orange-800 disabled:opacity-50"
        >
          {loading ? "送信中..." : "登録用URLを受け取る"}
        </button>
        <ol className="mt-6 space-y-1 text-xs text-stone-500">
          <li>1. メールアドレスを送信（この画面）</li>
          <li>2. 届いたメールの URL を開く（24時間有効）</li>
          <li>3. 企業情報・代表者・パスワードを入力して登録完了。すぐにログインできます</li>
        </ol>
        <p className="mt-4 text-center text-xs text-stone-500">
          既にアカウントをお持ちの方は <Link href="/login" className="font-medium text-orange-700 hover:underline">ログイン</Link>
        </p>
      </form>
    </ApplyShell>
  );
}
