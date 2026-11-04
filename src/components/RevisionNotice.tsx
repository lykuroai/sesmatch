import Link from "next/link";

// 規約改定（PRO版の提供開始）のお知らせ（PRO版仕様書 §12）。ホーム画面の「お知らせ」欄にのみ表示する。
// 2026-11-05 郭指示: 全画面上部のバナー（閉じるボタン付き）からホームのお知らせ欄へ変更。適用開始日以降はサーバ側の判定で表示されない
export function RevisionNotice({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:hidden">
      <h2 className="text-sm font-bold text-slate-500">お知らせ</h2>
      <p className="mt-2 text-sm text-slate-800">
        <span className="font-bold">利用規約等の改定のお知らせ（2026年11月4日）：</span>
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
    </section>
  );
}
