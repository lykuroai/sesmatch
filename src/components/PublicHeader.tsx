"use client";

// 未ログイン公開ページ（ログインLP・企業申込・企業登録のルール）共通のヘッダー。
// 2026-10-23 のログイン画面刷新に合わせた白ベースのデザイン
import Link from "next/link";
import { reportHomeApplyClick } from "@/lib/gtag";

export default function PublicHeader({ showApply = true }: { showApply?: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-stone-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 lg:px-6">
        <Link href="/login" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.svg" alt="SES DirectMatch ロゴ" className="h-8 w-8" />
          <span className="text-base font-bold tracking-tight text-stone-900 sm:text-lg">SES DirectMatch</span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-medium text-stone-600 md:flex">
          <Link href="/login#flow" className="hover:text-orange-800">ご利用の流れ</Link>
          <Link href="/login#features" className="hover:text-orange-800">選ばれる理由</Link>
          <Link href="/about" className="hover:text-orange-800">サービス紹介</Link>
          <Link href="/pricing" className="hover:text-orange-800">料金</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/login#login"
            className="hidden rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:border-stone-400 hover:bg-stone-50 sm:inline-block"
          >
            ログイン
          </Link>
          {showApply && (
            <Link
              href="/apply"
              onClick={reportHomeApplyClick}
              className="rounded-full bg-orange-700 px-4 py-2 text-sm font-bold text-white shadow-sm shadow-orange-700/30 hover:bg-orange-800"
            >
              無料で始める
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
