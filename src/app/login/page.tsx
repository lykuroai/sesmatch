"use client";

// ログイン + LP（サービス紹介）。
// 2026-10-23 デザイン刷新: 白ベースの明るい配色に変更。上部ナビ（ログイン／無料で始める）、
// ヒーロー（大見出し＋0円バッジ＋CTA、右にログインカード）、マッチングのイメージ、流れ、選ばれる理由の順。
// モバイルではログインカードを最上部に出す（ホーム/成約系はモバイル導線に出さない方針は従来どおり）
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { reportHomeApplyClick } from "@/lib/gtag";
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";

const FEATURES = [
  {
    icon: "shield",
    title: "商流は最大一社下まで",
    body: "二社下以降の流通・再転載・無承認の再仲介を禁止。多重下請けを排除し、単価と情報の透明性を守ります。",
  },
  {
    icon: "sparkles",
    title: "AIマッチング",
    body: "スキルシート・案件票を取り込むと、AIが要約・構造化して案件⇄人材を双方向にマッチング。公開画面に出るのは匿名カードだけです。",
  },
  {
    icon: "lock",
    title: "3段階の情報開示",
    body: "検索段階は匿名情報のみ。双方が承認して初めて、氏名・実額単価・企業名を相互同時に開示。片側だけに知られることはありません。",
  },
  {
    icon: "yen",
    title: "基本版は0円で利用可能",
    body: "掲載料・月額費用・成約手数料のすべてが0円。登録から成約・稼働管理まで、費用は一切かかりません。",
  },
];

const STEPS = [
  { no: "01", title: "登録・取込", body: "案件票やスキルシートをそのままアップロード。AIが匿名カードに整えます。" },
  { no: "02", title: "マッチング・エントリー", body: "条件が合う相手に応募・スカウト。メッセージも匿名のまま安全に。" },
  { no: "03", title: "双方承認・面談", body: "お互いが承認したら企業名・実名・実額を同時開示し、面談へ。" },
  { no: "04", title: "直接契約・稼働", body: "仲介業者を挟まず、需要側と供給側の2社間で直接契約。月次の稼働確認もプラットフォームで完結。" },
];

const FREE_BADGES = [
  { label: "掲載料", value: "0" },
  { label: "月額費用", value: "0" },
  { label: "成約手数料", value: "0" },
];

function FeatureIcon({ name }: { name: string }) {
  const common = "h-6 w-6";
  switch (name) {
    case "shield":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "sparkles":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" />
          <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
        </svg>
      );
    case "lock":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 118 0v3" />
        </svg>
      );
    default:
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M7 4l5 7 5-7" />
          <path d="M12 11v9M8 14h8M8 17h8" />
        </svg>
      );
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // 2要素認証の第2段階（PRO版仕様書 §4.11）: コード入力
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  function goConsole() {
    // モバイルはホーム（KPI）を案内しないため案件一覧を起点にする
    router.push(window.innerWidth < 768 ? "/projects" : "/");
    router.refresh();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    const body = await res.json().catch(() => null);
    if (res.ok && body?.mfaRequired) {
      setChallengeId(body.challengeId);
    } else if (res.ok) {
      goConsole();
    } else {
      setError(body?.error?.message ?? "ログインに失敗しました");
    }
  }

  async function submitMfa(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/v1/auth/login/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId, code: mfaCode }),
    });
    setLoading(false);
    if (res.ok) goConsole();
    else {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "コードを確認できませんでした");
      if (res.status === 401 && body?.error?.message?.includes("最初から")) {
        setChallengeId(null);
        setMfaCode("");
      }
    }
  }

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <PublicHeader />

      {/* ヒーロー */}
      <section className="relative overflow-hidden bg-gradient-to-b from-sky-50 via-white to-white">
        {/* 装飾の円（参考サイトの柔らかい背景図形） */}
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-blue-200/40 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -right-20 top-40 h-96 w-96 rounded-full bg-emerald-200/40 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-sky-100/60 blur-3xl" />

        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-8 lg:grid-cols-[1fr_400px] lg:items-center lg:gap-14 lg:px-6 lg:pb-24 lg:pt-16">
          {/* 訴求（モバイルではログインカードの下） */}
          <div className="order-2 lg:order-1">
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <p className="inline-block rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-medium text-blue-700">
                SES企業間マッチングプラットフォーム
              </p>
            </div>
            <h1 className="text-3xl font-bold leading-[1.3] tracking-tight text-slate-900 sm:text-4xl lg:text-[2.75rem]">
              余計な商流なしで、
              <br />
              案件と人材を
              <span className="bg-gradient-to-r from-blue-600 to-emerald-500 bg-clip-text text-transparent">直接つなぐ</span>。
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-relaxed text-slate-600 sm:text-base">
              SES DirectMatchは、AIが人材情報と案件情報を自動で要約・構造化し、
              条件やスキルに基づいて最適な組み合わせを提案する企業間マッチングプラットフォームです。
              マッチング成立後は、需要企業と提供企業が<span className="font-bold text-slate-900">直接契約</span>します。
            </p>

            {/* 0円バッジ */}
            <ul className="mt-7 flex flex-wrap gap-4">
              {FREE_BADGES.map((b) => (
                <li key={b.label} className="rounded-full bg-gradient-to-br from-blue-500 to-emerald-400 p-[3px] shadow-md shadow-blue-500/20">
                  <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-white sm:h-28 sm:w-28">
                    <span className="text-[11px] font-bold text-slate-500 sm:text-xs">{b.label}</span>
                    <span className="mt-0.5 flex items-baseline gap-0.5 leading-none">
                      <span className="text-3xl font-black text-blue-700 sm:text-4xl">{b.value}</span>
                      <span className="text-sm font-bold text-blue-700">円</span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/apply"
                onClick={reportHomeApplyClick}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 px-8 py-3.5 text-base font-bold text-white shadow-lg shadow-blue-600/30 transition hover:bg-blue-700"
              >
                <span className="rounded bg-white/20 px-1.5 py-0.5 text-xs font-bold">無料</span>
                企業登録を申し込む
                <span aria-hidden>→</span>
              </Link>
              <Link href="/about" className="inline-flex items-center justify-center gap-1 px-4 py-3 text-sm font-medium text-slate-600 hover:text-blue-700">
                サービス紹介を見る
                <span aria-hidden>›</span>
              </Link>
            </div>
            <p className="mt-4 text-xs text-slate-500">ご利用には企業（法人・個人事業者）としての登録が必要です。</p>
          </div>

          {/* ログインカード（モバイルでは最上部） */}
          <div id="login" className="order-1 w-full scroll-mt-20 lg:order-2">
            <div className="mb-4 flex items-center gap-3 lg:hidden">
              <p className="text-sm font-medium text-slate-600">
                案件と人材を、余計な商流なしで直接つなぐ。
              </p>
            </div>
            {challengeId ? (
            <form onSubmit={submitMfa} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/10 lg:p-8">
              <h2 className="text-xl font-bold">2要素認証</h2>
              <p className="mb-6 mt-1 text-sm text-slate-500">認証アプリに表示された6桁のコード（またはバックアップコード）を入力してください</p>
              {error && <p className="mb-4 rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{error}</p>}
              <input
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                required
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                className="mb-6 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-center text-lg tracking-widest focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <button type="submit" disabled={loading} className="w-full rounded-full bg-slate-900 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50">
                {loading ? "確認中..." : "ログイン"}
              </button>
              <button type="button" onClick={() => { setChallengeId(null); setMfaCode(""); setError(null); }} className="mt-3 w-full text-xs text-slate-500 hover:underline">
                最初からやり直す
              </button>
            </form>
            ) : (
            <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/10 lg:p-8">
              <h2 className="text-xl font-bold">企業コンソール</h2>
              <p className="mb-6 mt-1 text-sm text-slate-500">登録済みの企業アカウントでログイン</p>
              {error && <p className="mb-4 rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{error}</p>}
              <label className="mb-1 block text-sm font-medium text-slate-700">メールアドレス</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="mb-4 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <label className="mb-1 block text-sm font-medium text-slate-700">パスワード</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="mb-6 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-full bg-slate-900 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {loading ? "ログイン中..." : "ログイン"}
              </button>
              <div className="mt-6 rounded-xl bg-gradient-to-br from-sky-50 to-emerald-50 p-4 text-center">
                <p className="text-sm font-bold text-slate-800">はじめてのご利用ですか？</p>
                <p className="mt-1 text-xs text-slate-600">
                  掲載料・月額費用・成約手数料すべて0円でご利用いただけます。
                </p>
                <Link
                  href="/apply"
                  onClick={reportHomeApplyClick}
                  className="mt-3 inline-block w-full rounded-full bg-blue-600 py-2.5 text-sm font-bold text-white shadow-sm shadow-blue-600/30 hover:bg-blue-700"
                >
                  企業登録を申し込む
                </Link>
              </div>
            </form>
            )}
          </div>
        </div>
      </section>

      {/* マッチングのイメージ（匿名カード同士がつながる様子） */}
      <section className="mx-auto max-w-6xl px-4 py-14 lg:px-6 lg:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">Matching</p>
            <h2 className="mt-2 text-2xl font-bold leading-snug sm:text-3xl">
              匿名カードのまま、
              <br />
              条件の合う相手が見つかる
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-600 sm:text-base">
              取り込んだ案件票・スキルシートは、AIがスキル・単価・時期・勤務条件を項目化。
              検索画面に出るのは企業名も氏名も伏せた匿名カードだけなので、情報漏えいを心配せずに候補を探せます。
              マッチ度は点数で表示され、案件からも人材からも双方向に検索できます。
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-xl shadow-slate-900/5 sm:p-6" aria-label="マッチング画面のイメージ">
            <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <span className="rounded bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">案件</span>
                <p className="mt-2 text-sm font-bold">基幹システム刷新 バックエンド開発</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {["Java", "Spring", "AWS"].map((s) => (
                    <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{s}</span>
                  ))}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-1 text-xs text-slate-600">
                  <dt>単価</dt><dd className="text-right font-medium text-slate-800">〜80万円</dd>
                  <dt>勤務</dt><dd className="text-right font-medium text-slate-800">東京・一部リモート</dd>
                  <dt>開始</dt><dd className="text-right font-medium text-slate-800">来月〜</dd>
                </dl>
              </div>
              <div className="flex items-center justify-center sm:flex-col">
                <div className="flex h-16 w-16 flex-col items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-emerald-500 text-white shadow-lg shadow-blue-600/30">
                  <span className="text-xl font-black leading-none">92</span>
                  <span className="text-[10px] font-bold">マッチ</span>
                </div>
                <span aria-hidden className="ml-2 text-2xl text-slate-400 sm:ml-0 sm:mt-1">⇄</span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">人材</span>
                <p className="mt-2 text-sm font-bold">Javaエンジニア（経験8年）</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {["Java", "Spring", "AWS", "PostgreSQL"].map((s) => (
                    <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{s}</span>
                  ))}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-1 text-xs text-slate-600">
                  <dt>希望単価</dt><dd className="text-right font-medium text-slate-800">75万円〜</dd>
                  <dt>最寄</dt><dd className="text-right font-medium text-slate-800">東京都内</dd>
                  <dt>稼働</dt><dd className="text-right font-medium text-slate-800">来月〜</dd>
                </dl>
              </div>
            </div>
            <p className="mt-3 text-center text-[11px] text-slate-400">※ 画面はイメージです。企業名・氏名は双方承認後に開示されます。</p>
          </div>
        </div>
      </section>

      {/* ご利用の流れ */}
      <section id="flow" className="scroll-mt-16 bg-slate-50 py-14 lg:py-20">
        <div className="mx-auto max-w-6xl px-4 lg:px-6">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">Flow</p>
            <h2 className="mt-2 text-2xl font-bold sm:text-3xl">直接契約までの流れ</h2>
          </div>
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.no} className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <span className="text-3xl font-black text-blue-600/80">{s.no}</span>
                <p className="mt-2 text-base font-bold text-slate-900">{s.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 選ばれる理由 */}
      <section id="features" className="scroll-mt-16 py-14 lg:py-20">
        <div className="mx-auto max-w-6xl px-4 lg:px-6">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">Feature</p>
            <h2 className="mt-2 text-2xl font-bold sm:text-3xl">選ばれる理由</h2>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-50 to-emerald-50 text-blue-700">
                  <FeatureIcon name={f.icon} />
                </div>
                <div>
                  <p className="text-base font-bold text-slate-900">{f.title}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA帯 */}
      <section className="mx-auto max-w-6xl px-4 pb-14 lg:px-6 lg:pb-20">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-blue-700 to-emerald-600 px-6 py-10 text-center text-white sm:px-10 lg:py-14">
          <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10" />
          <div aria-hidden className="pointer-events-none absolute -bottom-16 -left-10 h-56 w-56 rounded-full bg-white/10" />
          <p className="relative text-sm font-bold tracking-wide text-emerald-100">掲載料・月額費用・成約手数料 すべて0円</p>
          <h2 className="relative mt-2 text-2xl font-bold sm:text-3xl">まずは無料で企業登録</h2>
          <p className="relative mx-auto mt-3 max-w-xl text-sm text-blue-50">
            登録から成約・稼働管理まで、費用は一切かかりません。申込みは即時開通です。
          </p>
          <Link
            href="/apply"
            onClick={reportHomeApplyClick}
            className="relative mt-6 inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-base font-bold text-blue-700 shadow-lg transition hover:bg-blue-50"
          >
            企業登録を申し込む
            <span aria-hidden>→</span>
          </Link>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
