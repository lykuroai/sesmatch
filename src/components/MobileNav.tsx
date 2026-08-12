"use client";

// モバイル用ドロワーメニュー（md 未満で表示）。
// ヘッダーのハンバーガーボタンで開閉し、リンク選択・背景タップで閉じる。
// 表示項目はレイアウト側から渡す（成約・稼働／成約手数料はモバイルでは案内しない）
import { useState } from "react";
import Link from "next/link";
import { LogoutButton } from "./LogoutButton";

export type MobileNavItem = { href: string; label: string; icon: string };

function ItemIcon({ path }: { path: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 flex-none text-slate-400"
    >
      <path d={path} />
    </svg>
  );
}

export function MobileNav({ items, manual }: { items: MobileNavItem[]; manual: MobileNavItem }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(true)}
        aria-label="メニューを開く"
        className="-ml-1 flex h-10 w-10 items-center justify-center rounded text-slate-600 hover:bg-slate-100"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          className="h-6 w-6"
        >
          <path d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50">
          {/* 背景（タップで閉じる） */}
          <div className="absolute inset-0 bg-black/40" onClick={close} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              {/* モバイルの起点は先頭メニュー（案件一覧）。ホームは案内しない */}
              <Link href={items[0]?.href ?? "/"} onClick={close} className="flex items-center gap-2 text-sm font-bold text-slate-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-mark.svg" alt="" className="h-6 w-6" />
                SES DirectMatch
              </Link>
              <button
                onClick={close}
                aria-label="メニューを閉じる"
                className="flex h-10 w-10 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  className="h-6 w-6"
                >
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-2">
              {items.map((m) => (
                <Link
                  key={m.href}
                  href={m.href}
                  onClick={close}
                  className="flex items-center gap-3 rounded px-3 py-3 text-sm text-slate-700 hover:bg-slate-100"
                >
                  <ItemIcon path={m.icon} />
                  <span>{m.label}</span>
                </Link>
              ))}
            </nav>
            <div className="p-2">
              <div className="border-t border-slate-100 pt-2">
                <Link
                  href={manual.href}
                  onClick={close}
                  className="flex items-center gap-3 rounded px-3 py-3 text-sm text-slate-700 hover:bg-slate-100"
                >
                  <ItemIcon path={manual.icon} />
                  <span>{manual.label}</span>
                </Link>
              </div>
            </div>
            <div className="px-5 pb-5">
              <LogoutButton />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
