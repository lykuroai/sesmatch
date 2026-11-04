// 規約改定（PRO版の提供開始）の告知。利用規約第7条・基本契約第4条は「適用開始日の1か月前までに本サービス上の表示で通知」を要件とする
// （PRO版仕様書 §12）。適用開始日は 2026-12-04（2026-11-04 郭確定）。日付判定は JST
export const REVISION_EFFECTIVE_DATE = "2026-12-04";
export const REVISION_NOTICE_FROM = "2026-11-04";

// JST の暦日（YYYY-MM-DD）
export function jstDateString(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 告知期間中（告知日以降、適用開始日の前日まで）なら true。適用開始日以降は自動的に消える。表示はホームの「お知らせ」欄のみ（2026-11-05 郭指示）
export function isRevisionNoticeActive(now: Date = new Date()): boolean {
  const d = jstDateString(now);
  return d >= REVISION_NOTICE_FROM && d < REVISION_EFFECTIVE_DATE;
}
