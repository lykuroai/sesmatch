// 月次の定期処理（PRO版仕様書 §9 内部処理）。プロセス内タイマー（scheduler.ts）から 1 時間ごとに
// 内部 API POST /internal/jobs/periodic 経由で呼ばれる。各処理は実行済み判定を持ち、何度呼んでも二重処理しない
//
// - 毎月1日（JST）: 前月分の監査ログのダウンロードリンクを PRO 企業の代表へ送付（§4.14）
// - 月末（JST 最終日 12 時以降）: カード決済企業の追加担当者数を Stripe に報告（§4.15）

import { sendMonthlyAuditExportLinks } from "./audit-export";
import { isLastDayOfMonthJst, jstHour, reportExtraSeatsForCardCompanies } from "./card-billing";

const jstDay = (now: Date) => new Date(now.getTime() + 9 * 3600_000).getUTCDate();

export async function runPeriodicJobs(now = new Date(), opts: { force?: boolean } = {}) {
  const out: Record<string, unknown> = { at: now.toISOString() };
  if (opts.force || jstDay(now) === 1) out.auditMonthly = await sendMonthlyAuditExportLinks(now);
  if (opts.force || (isLastDayOfMonthJst(now) && jstHour(now) >= 12)) out.cardSeats = await reportExtraSeatsForCardCompanies(now);
  return out;
}
