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
      router.push("/");
      router.refresh();
    } else {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "ログインに失敗しました");
    }
  }

  return (
    <main className="min-h-screen bg-slate-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-10 lg:flex-row lg:items-start lg:gap-14 lg:py-16">
        {/* LP: サービス紹介 */}
        <section className="flex-1 text-slate-100">
          <p className="mb-3 inline-block rounded-full bg-blue-500/20 px-3 py-1 text-xs font-medium text-blue-300">
            SES企業間マッチングプラットフォーム
          </p>
          <h1 className="text-3xl font-bold leading-snug lg:text-4xl">
            Lykuro DirectMatch
            <span className="mt-2 block text-lg font-medium text-slate-300 lg:text-xl">
              案件と人材を、余計な商流なしで直接つなぐ。
            </span>
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-400">
            Lykuro DirectMatch（AI人材・案件ダイレクトマッチング）は、SES企業同士が案件情報と人材情報を安全に流通させ、
            双方承認から<span className="text-slate-200">2社間の直接契約</span>までを一気通貫で行える
            B2Bプラットフォームです。仲介の多段化で失われていたマージンと情報を、現場に取り戻します。
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

          <p className="mt-6 text-xs text-slate-500">
            ご利用には企業（法人・個人事業者）としての登録と運営審査が必要です。
            <Link href="/terms" className="underline hover:text-slate-300">利用規約</Link>・
            <Link href="/agreement" className="underline hover:text-slate-300">基本契約</Link>・
            <Link href="/privacy-policy" className="underline hover:text-slate-300">プライバシーポリシー</Link>
          </p>
        </section>

        {/* ログイン */}
        <div className="w-full lg:w-96 lg:shrink-0">
          <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-8 shadow-lg">
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
