-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'SIGNED_SUPPLY', 'SIGNED_DEMAND', 'EXECUTED', 'ACTIVE', 'CANCELLED', 'TERMINATED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "WorkMonthStatus" AS ENUM ('PENDING', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "FeeStatus" AS ENUM ('CHARGED', 'FREE', 'REFUNDED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'PAID');

-- CreateEnum
CREATE TYPE "PrivacyRequestKind" AS ENUM ('CORRECTION', 'DELETION');

-- CreateEnum
CREATE TYPE "PrivacyRequestStatus" AS ENUM ('RECEIVED', 'APPROVED', 'REJECTED', 'COMPLETED');

-- AlterTable
ALTER TABLE "engineers" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "demandCompanyId" TEXT NOT NULL,
    "supplyCompanyId" TEXT NOT NULL,
    "contractType" TEXT NOT NULL,
    "monthlyRateYen" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "commandChecklist" JSONB NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "supplySignedAt" TIMESTAMP(3),
    "supplySignedBy" TEXT,
    "demandSignedAt" TIMESTAMP(3),
    "demandSignedBy" TEXT,
    "workStartedAt" TIMESTAMP(3),
    "terminatedAt" TIMESTAMP(3),
    "terminationReason" TEXT,
    "createdByCompanyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_months" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "confirmedAmountYen" INTEGER NOT NULL,
    "status" "WorkMonthStatus" NOT NULL DEFAULT 'CONFIRMED',
    "confirmedByMemberId" TEXT,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_months_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_fees" (
    "id" TEXT NOT NULL,
    "workMonthId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "demandCompanyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "baseAmountYen" INTEGER NOT NULL,
    "feeExTaxYen" INTEGER NOT NULL,
    "chargeableMonthIndex" INTEGER NOT NULL,
    "status" "FeeStatus" NOT NULL,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "demandCompanyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "feeExTaxYen" INTEGER NOT NULL,
    "taxYen" INTEGER NOT NULL,
    "totalYen" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_requests" (
    "id" TEXT NOT NULL,
    "tenantCompanyId" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "kind" "PrivacyRequestKind" NOT NULL,
    "reason" TEXT,
    "status" "PrivacyRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decisionDeadline" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedByMemberId" TEXT,
    "scheduledPurgeAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contracts_entryId_key" ON "contracts"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "work_months_contractId_month_key" ON "work_months"("contractId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "platform_fees_workMonthId_key" ON "platform_fees"("workMonthId");

-- CreateIndex
CREATE INDEX "platform_fees_projectId_engineerId_demandCompanyId_idx" ON "platform_fees"("projectId", "engineerId", "demandCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_demandCompanyId_month_key" ON "invoices"("demandCompanyId", "month");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_months" ADD CONSTRAINT "work_months_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_fees" ADD CONSTRAINT "platform_fees_workMonthId_fkey" FOREIGN KEY ("workMonthId") REFERENCES "work_months"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
