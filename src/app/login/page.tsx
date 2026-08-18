"use client";

// ログイン + LP（サービス紹介）。左にプラットフォームの価値訴求と直接契約の仕組み、右にログイン
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const FEATURES = [
  {
    title: "商流は最大一社下まで",
    body: "二社下以降の流通・再転載・無承認の再仲介を禁止。多重下請けを排除し、単価と情報の透明性を守ります。",
  },
  {
    title: "AIマッチング",
    body: "スキルシート・案件票を取り込むと、匿名化とAI正規化を経て案件⇄人材を双方向にマッチング。個人情報はAIに送信しません。",
  },
  {
    title: "3段階の情報開示",
    body: "検索段階は匿名情報のみ。双方が承認して初めて、氏名・実額単価・企業名を相互同時に開示。片側だけに知られることはありません。",
  },
  {
    title: "成約手数料は3%だけ",
    body: "掲載料・月額費用は0円。成約した契約金額の3%（需要側負担）のみで、13稼働月目以降は手数料も0円になります。",
  },
];

const STEPS = [
  { no: "1", title: "登録・取込", body: "案件票やスキルシートをそのままアップロード。AIが匿名カードに整えます。" },
  { no: "2", title: "マッチング・エントリー", body: "条件が合う相手に応募・スカウト。メッセージも匿名のまま安全に。" },
  { no: "3", title: "双方承認・面談", body: "お互いが承認したら企業名・実名・実額を同時開示し、面談へ。" },
  { no: "4", title: "直接契約・稼働", body: "仲介業者を挟まず、需要側と供給側の2社間で直接契約。月次の稼働確認と請求もプラットフォームで完結。" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    if (res.ok) {
      // モバイルはホーム（KPI）を案内しないため案件一覧を起点にする
      router.push(window.innerWidth < 768 ? "/projects" : "/");
      router.refresh();
    } else {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "ログインに失敗しました");
    }
  }

  return (
    <main className="min-h-screen bg-slate-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-8 lg:flex-row lg:items-start lg:gap-14 lg:px-6 lg:py-16">
        {/* LP: サービス紹介（モバイルではログインフォームの下に表示） */}
        <section className="order-2 flex-1 text-slate-100 lg:order-1">
          <p className="mb-3 inline-block rounded-full bg-blue-500/20 px-3 py-1 text-xs font-medium text-blue-300">
            SES企業間マッチングプラットフォーム
          </p>
          <h1 className="text-3xl font-bold leading-snug lg:text-4xl">
            <span className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-mark.svg" alt="SES DirectMatch ロゴ" className="h-10 w-10 lg:h-12 lg:w-12" />
              SES DirectMatch
            </span>
            <span className="mt-2 block text-lg font-medium text-slate-300 lg:text-xl">
              案件と人材を、余計な商流なしで直接つなぐ。
            </span>
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-400">
            SES DirectMatchは、AIが人材情報と案件情報を自動で要約・構造化し、
            条件やスキルに基づいて最適な組み合わせを提案する企業間マッチングプラットフォームです。
            マッチング成立後は、需要企業と提供企業が<span className="text-slate-200">直接契約</span>します。
          </p>

          <h2 className="mt-8 mb-3 text-sm font-bold uppercase tracking-wide text-blue-300">
            直接契約までの流れ
          </h2>
          <ol className="space-y-3">
            {STEPS.map((s) => (
              <li key={s.no} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  {s.no}
                </span>
                <div>
                  <p className="text-sm font-medium text-slate-100">{s.title}</p>
                  <p className="text-xs leading-relaxed text-slate-400">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <h2 className="mt-8 mb-3 text-sm font-bold uppercase tracking-wide text-blue-300">
            選ばれる理由
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-lg border border-slate-700/60 bg-slate-800/60 p-4">
                <p className="mb-1 text-sm font-bold text-slate-100">{f.title}</p>
                <p className="text-xs leading-relaxed text-slate-400">{f.body}</p>
              </div>
            ))}
          </div>

          {/* 関連サービスの宣伝: AI Gateway */}
          <a
            href="https://app.lykuro.ai"
            target="_blank"
            rel="noopener"
            className="mt-8 block rounded-lg border border-blue-500/40 bg-blue-500/10 p-4 transition hover:bg-blue-500/20"
          >
            <p className="text-sm font-bold text-blue-300">
              AI Gateway <span className="ml-1 text-xs font-normal text-slate-400">app.lykuro.ai ↗</span>
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              本サービスのAI機能を支えるLLMゲートウェイ。複数のAIモデルをひとつのAPIで利用できます。
            </p>
          </a>

          <p className="mt-6 text-xs text-slate-500">
            ご利用には企業（法人・個人事業者）としての登録と運営審査が必要です。
            <Link href="/about" className="underline hover:text-slate-300">サービス紹介</Link>・
            <Link href="/terms" className="underline hover:text-slate-300">利用規約</Link>・
            <Link href="/agreement" className="underline hover:text-slate-300">基本契約</Link>・
            <Link href="/privacy-policy" className="underline hover:text-slate-300">プライバシーポリシー</Link>
          </p>
        </section>

        {/* ログイン（モバイルでは最上部に表示） */}
        <div className="order-1 w-full lg:order-2 lg:w-96 lg:shrink-0">
          {/* モバイル用の簡易ブランドヘッダー（LPが下に回るため） */}
          <div className="mb-4 flex items-center gap-3 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.svg" alt="SES DirectMatch ロゴ" className="h-9 w-9" />
            <div>
              <p className="text-lg font-bold leading-tight text-slate-100">SES DirectMatch</p>
              <p className="text-xs text-slate-400">案件と人材を、余計な商流なしで直接つなぐ。</p>
            </div>
          </div>
          <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-6 shadow-lg lg:p-8">
            <h2 className="mb-1 text-xl font-bold">企業コンソール</h2>
            <p className="mb-6 text-sm text-slate-500">登録済みの企業アカウントでログイン</p>
            {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
            <label className="mb-1 block text-sm font-medium">メールアドレス</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
            <label className="mb-1 block text-sm font-medium">パスワード</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mb-6 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "ログイン中..." : "ログイン"}
            </button>
            <div className="mt-6 rounded-lg bg-slate-50 p-4 text-center">
              <p className="text-sm font-medium text-slate-700">はじめてのご利用ですか？</p>
              <p className="mt-1 text-xs text-slate-500">登録・掲載は無料。成約するまで費用はかかりません。</p>
              <Link
                href="/apply"
                className="mt-3 inline-block w-full rounded border border-blue-600 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50"
              >
                企業登録を申し込む（無料）
              </Link>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
