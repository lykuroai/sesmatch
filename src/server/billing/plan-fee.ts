// PRO 版の月額利用料の純粋ロジック（PRO版仕様書 §2, §6）。テスト対象。
//
// - PRO 月額 39,800円（税別）。担当者5名（planSeats）まで含み、6名以降は 1名 4,000円/月
// - 年払い（398,000円）は 2026-11-05 に廃止（郭決定。割引なし・月払いのみ）。billingCycle は互換のため受け取るが金額には影響しない
// - 日割りなし: 開始当月は無料、翌月分から請求（開始月 < 対象月 のときだけ請求対象）
// - TRIAL・FREE・カード決済（CARD）の企業は請求書払いの対象外
// - 税額は請求書単位で1回だけ端数処理（切り捨て。成約手数料と同じ calcTax）

import { calcTax } from "./fee";

export const PRO_MONTHLY_YEN = 39_800;
export const EXTRA_SEAT_YEN = 4_000;

export type PlanInvoiceInput = {
  plan: "FREE" | "TRIAL" | "PRO";
  billingCycle: "MONTHLY" | "YEARLY"; // YEARLY は廃止済み（金額に影響しない）
  paymentMethod: "INVOICE" | "CARD";
  planSeats: number;
  activeMembers: number;
  planStartedAt: Date | null;
  month: string; // 対象月 YYYY-MM
};

export type PlanInvoiceCalc = {
  baseYen: number;
  extraSeats: number;
  extraYen: number;
  amountExTaxYen: number;
  taxYen: number;
  totalYen: number;
};

const monthIndex = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
};
export const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

// 対象月が請求対象か（PRO・請求書払い・開始月より後）
export function isBillableMonth(input: PlanInvoiceInput): boolean {
  if (input.plan !== "PRO" || input.paymentMethod !== "INVOICE" || !input.planStartedAt) return false;
  return monthIndex(monthKey(input.planStartedAt)) < monthIndex(input.month);
}

// 請求額を計算する。請求対象外・請求額0円なら null
export function calcPlanInvoice(input: PlanInvoiceInput): PlanInvoiceCalc | null {
  if (!isBillableMonth(input)) return null;
  const extraSeats = Math.max(0, input.activeMembers - input.planSeats);
  const extraYen = extraSeats * EXTRA_SEAT_YEN;
  const baseYen = PRO_MONTHLY_YEN;
  const amountExTaxYen = baseYen + extraYen;
  if (amountExTaxYen === 0) return null;
  const taxYen = calcTax(amountExTaxYen);
  return { baseYen, extraSeats, extraYen, amountExTaxYen, taxYen, totalYen: amountExTaxYen + taxYen };
}

// 支払期限: 対象月の翌月末（月末締め・翌月末振込）
export function dueDateOf(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m + 1, 0, 14, 59, 59)); // 翌月末日 23:59:59 JST
}

// 請求書番号: P-YYYYMM-NNNN
export function invoiceNumberOf(month: string, seq: number): string {
  return `P-${month.replace("-", "")}-${String(seq).padStart(4, "0")}`;
}
