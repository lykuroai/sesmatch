"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { REVISION_EFFECTIVE_DATE } from "@/lib/revision-notice";

// 規約改定（PRO版の提供開始）の告知バナー（PRO版仕様書 §12）。コンソールの全画面の上部に表示する。
// 「閉じる」はこのブラウザ内だけで有効（localStorage）。適用開始日以降はサーバ側の判定で表示されない
const KEY = `sesmatch_revision_notice_${REVISION_EFFECTIVE_DATE}`;

export function RevisionNotice({ active }: { active: boolean }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(KEY) === "1");
    } catch {
      setHidden(false);
    }
  }, []);
  if (!active || hidden) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* 保存できなくても閉じる */
    }
    setHidden(true);
  };
  return (
    <div className="mb-4 flex items-start gap-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 print:hidden">
      <p className="min-w-0 flex-1">
        <span className="font-bold">利用規約等の改定のお知らせ：</span>
        2026年12月4日より有料プラン「PRO版」の提供を開始します。これに伴い
        <Link href="/terms" className="underline">
          利用規約
        </Link>
        ・
        <Link href="/agreement" className="underline">
          基本契約
        </Link>
        ・
        <Link href="/privacy-policy" className="underline">
          プライバシーポリシー
        </Link>
        を改定しました（PRO版利用企業には掲載企業名が表示されます）。基本版は引き続き無料でご利用いただけます。詳しくは
        <Link href="/pricing" className="underline">
          料金ページ
        </Link>
        をご覧ください。
      </p>
      <button
        type="button"
        onClick={close}
        aria-label="お知らせを閉じる"
        className="shrink-0 rounded px-1 text-lg leading-none text-amber-700 hover:bg-amber-100"
      >
        ×
      </button>
    </div>
  );
}
