// 成約手数料エンジン（§23）— 純粋関数（テスト対象 §34）

export const FEE_RATE_PERCENT = 3;
export const MAX_CHARGEABLE_MONTHS = 12; // 実稼働開始から最大12稼働月。13稼働月目以降は無料
export const REFUND_WINDOW_DAYS = 14; // 開始後14日以内の離脱は徴収済み手数料全額返金
export const NEW_COMPANY_FREE_DAYS = 30; // 新規企業は利用開始（運営承認）から30日間手数料無料

// 新規企業の無料期間判定: 対象稼働月（"YYYY-MM"）の月初が承認日+30日以内なら、その月の手数料は無料。
// 月の途中で無料期間が切れる場合もその月は無料（月単位・日割りなし）。
// 無料月は CHARGED に数えないため、12稼働月上限の課金枠は消費しない
export function isNewCompanyFreeMonth(month: string, approvedAt: Date): boolean {
  const [y, m] = month.split("-").map(Number);
  const monthStart = Date.UTC(y, m - 1, 1);
  return monthStart <= approvedAt.getTime() + NEW_COMPANY_FREE_DAYS * 86_400_000;
}

// fee_ex_tax = floor(chargeable_contract_amount_yen × 3 / 100)
export function calcFeeExTax(chargeableContractAmountYen: number): number {
  return Math.floor((chargeableContractAmountYen * FEE_RATE_PERCENT) / 100);
}

export type FeeDecision = {
  chargeableMonthIndex: number; // 何稼働月目か（1〜）
  feeExTaxYen: number;
  status: "CHARGED" | "FREE";
};

// 12か月上限は (案件, 人材, 需要側企業) の組合せで集計する。
// priorChargedMonths: 同一組合せで既に課金済みの稼働月数（更新契約を跨いで数える。リセットしない）
// newCompanyFree: 需要側企業の新規30日間無料期間内の稼働月（isNewCompanyFreeMonth で判定）
export function decideFee(
  amountYen: number,
  priorChargedMonths: number,
  newCompanyFree = false
): FeeDecision {
  const index = priorChargedMonths + 1;
  if (priorChargedMonths >= MAX_CHARGEABLE_MONTHS || newCompanyFree) {
    return { chargeableMonthIndex: index, feeExTaxYen: 0, status: "FREE" };
  }
  return { chargeableMonthIndex: index, feeExTaxYen: calcFeeExTax(amountYen), status: "CHARGED" };
}

// 開始後14日以内の離脱か（境界日を含む）
export function isWithinRefundWindow(workStartedAt: Date, terminatedAt: Date): boolean {
  const diffDays = (terminatedAt.getTime() - workStartedAt.getTime()) / 86_400_000;
  return diffDays <= REFUND_WINDOW_DAYS;
}

// 消費税（10%・切り捨て）。税率は §36 実装前決定事項のため暫定
export function calcTax(feeExTaxYen: number): number {
  return Math.floor(feeExTaxYen * 0.1);
}
