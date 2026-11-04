-- 段階C（PRO版仕様書 §4.12〜§4.15）: カード決済（Stripe）の識別子、SSO の企業識別子、Stripe 請求書の同期列

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "cardPaymentFailedAt" TIMESTAMP(3),
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT;

-- AlterTable
ALTER TABLE "company_security_settings" ADD COLUMN     "ssoSlug" TEXT;

-- AlterTable
ALTER TABLE "plan_invoices" ADD COLUMN     "stripeHostedUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "companies_stripeCustomerId_key" ON "companies"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "companies_stripeSubscriptionId_key" ON "companies"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "company_security_settings_ssoSlug_key" ON "company_security_settings"("ssoSlug");

-- CreateIndex
CREATE UNIQUE INDEX "plan_invoices_stripeInvoiceId_key" ON "plan_invoices"("stripeInvoiceId");
