import Link from "next/link";

// 規約・契約・ポリシーの公開ページ共通レイアウト（未ログインで閲覧可能）
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between text-sm">
          <Link href="/" className="font-bold text-slate-800">
            SES DirectMatch
          </Link>
          <nav className="flex gap-4 text-xs text-slate-500">
            <Link href="/terms" className="hover:underline">
              利用規約
            </Link>
            <Link href="/agreement" className="hover:underline">
              基本契約
            </Link>
            <Link href="/privacy-policy" className="hover:underline">
              プライバシーポリシー
            </Link>
          </nav>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">{children}</div>
        <p className="mt-6 text-center text-xs text-slate-400">
          <Link href="/apply" className="hover:underline">
            企業登録の申込へ戻る
          </Link>
        </p>
      </div>
    </main>
  );
}
