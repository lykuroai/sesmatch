// 成約手数料エンジン（§23）— 純粋関数（テスト対象 §34）

export const FEE_RATE_PERCENT = 3;
export const MAX_CHARGEABLE_MONTHS = 12; // 実稼働開始から最大12稼働月。13稼働月目以降は無料
export const REFUND_WINDOW_DAYS = 14; // 開始後14日以内の離脱は徴収済み手数料全額返金

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
export function decideFee(amountYen: number, priorChargedMonths: number): FeeDecision {
  const index = priorChargedMonths + 1;
  if (priorChargedMonths >= MAX_CHARGEABLE_MONTHS) {
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
