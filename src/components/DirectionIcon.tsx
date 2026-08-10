// 提案の起点アイコン: 右向き=自社が提案を開始 / 左向き=他社が提案を開始
// （エントリー一覧・詳細で共用。純粋な表示コンポーネントのため RSC からも使用可）
export function DirectionIcon({ own }: { own: boolean }) {
  const title = own ? "自社が提案を開始" : "他社が提案を開始";
  return (
    <svg
      viewBox="0 0 18 18"
      role="img"
      aria-label={title}
      className={`inline-block h-[18px] w-[18px] rounded-full align-[-4px] ${own ? "bg-blue-100 text-blue-600" : "bg-emerald-100 text-emerald-600"}`}
    >
      <title>{title}</title>
      {own ? (
        <path d="M5 9h7M9.5 6l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M13 9H6M8.5 6l-3 3 3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}
