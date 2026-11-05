import { redirect } from "next/navigation";

// 「成約手数料」画面は 2026-11-05 に廃止（郭指示。基本版は完全無料のため）。
// プラン・PRO 版の請求書は会社マイページ「プラン・請求」（/company/plan）に移した。
// 過去の成約手数料の請求書 PDF（/billing/invoices/:id）と PRO 請求書（/billing/plan-invoices/:id）の URL はそのまま有効
export default function BillingPage() {
  redirect("/company/plan");
}
