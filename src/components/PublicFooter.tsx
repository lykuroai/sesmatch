import Link from "next/link";

// 未ログイン公開ページ共通のフッター（ログインLPと同じ構成）
export default function PublicFooter() {
  return (
    <footer className="border-t border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 lg:flex-row lg:items-start lg:justify-between lg:px-6">
        <div>
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.svg" alt="" className="h-7 w-7" />
            <span className="font-bold">SES DirectMatch</span>
          </div>
          <p className="mt-2 text-xs text-stone-500">案件と人材を、余計な商流なしで直接つなぐ。</p>
          {/* 関連サービス: AI Gateway */}
          <a href="https://app.lykuro.ai" target="_blank" rel="noopener" className="mt-3 inline-block text-xs text-stone-500 hover:text-orange-800">
            本サービスのAI機能を支える LLMゲートウェイ <span className="font-bold text-orange-800">AI Gateway</span>（app.lykuro.ai ↗）
          </a>
        </div>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-stone-600">
          <Link href="/about" className="hover:text-orange-800">サービス紹介</Link>
          <Link href="/pricing" className="hover:text-orange-800">料金</Link>
          <Link href="/apply/rules" className="hover:text-orange-800">企業登録のルール</Link>
          <Link href="/terms" className="hover:text-orange-800">利用規約</Link>
          <Link href="/agreement" className="hover:text-orange-800">基本契約</Link>
          <Link href="/privacy-policy" className="hover:text-orange-800">プライバシーポリシー</Link>
          <Link href="/tokushoho" className="hover:text-orange-800">特定商取引法に基づく表記</Link>
        </nav>
      </div>
    </footer>
  );
}
