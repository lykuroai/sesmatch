// PRO 版の自己申込（新規登録画面・会社マイページ）の受付期間と、解約の効力発生日の純粋ロジック（2026-11-05 郭指示）。
// - 受付開始は規約の適用開始日 2026-12-04（JST）。それまでは画面に出さず、API も拒否する
// - 解約は当月末まで有効、翌月から基本版（返金なし）。期限は申請を承認した月の末日 23:59:59 JST
import { jstDateString, REVISION_EFFECTIVE_DATE } from "@/lib/revision-notice";

export const PRO_SIGNUP_OPEN_FROM = REVISION_EFFECTIVE_DATE; // "2026-12-04"
export const PRO_SIGNUP_CLOSED_MESSAGE = "PRO 版の申込受付は 2026年12月4日 からです";

export function isProSignupOpen(now: Date = new Date()): boolean {
  return jstDateString(now) >= PRO_SIGNUP_OPEN_FROM;
}

// now を含む月の末日（JST）の "YYYY-MM-DD"。運営のプラン変更 API（日付指定はその日の 23:59:59 JST まで有効）に渡す
export function endOfMonthJst(now: Date = new Date()): string {
  const [y, m] = jstDateString(now).split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // 当月末日
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}
