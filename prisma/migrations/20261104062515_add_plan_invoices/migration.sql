-- CreateEnum
CREATE TYPE "PlanInvoiceStatus" AS ENUM ('ISSUED', 'PAID', 'VOID');

-- AlterTable
ALTER TABLE "inquiries" ADD COLUMN     "priority" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "plan_invoices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "plan" "CompanyPlan" NOT NULL,
    "billingCycle" "PlanBillingCycle" NOT NULL,
    "seats" INTEGER NOT NULL,
    "activeMembers" INTEGER NOT NULL,
    "extraSeats" INTEGER NOT NULL,
    "baseYen" INTEGER NOT NULL,
    "extraYen" INTEGER NOT NULL,
    "amountExTaxYen" INTEGER NOT NULL,
    "taxYen" INTEGER NOT NULL,
    "totalYen" INTEGER NOT NULL,
    "status" "PlanInvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "stripeInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_invoices_invoiceNumber_key" ON "plan_invoices"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "plan_invoices_companyId_month_key" ON "plan_invoices"("companyId", "month");
