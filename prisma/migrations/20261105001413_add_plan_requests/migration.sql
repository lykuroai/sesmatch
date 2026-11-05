-- CreateEnum
CREATE TYPE "PlanRequestKind" AS ENUM ('UPGRADE', 'CANCEL');

-- CreateEnum
CREATE TYPE "PlanRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "plan_requests" (
    "id" TEXT NOT NULL,
    "tenantCompanyId" TEXT NOT NULL,
    "kind" "PlanRequestKind" NOT NULL,
    "status" "PlanRequestStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "requestedByMemberId" TEXT,
    "note" TEXT,
    "processedAt" TIMESTAMP(3),
    "processedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_requests_tenantCompanyId_status_idx" ON "plan_requests"("tenantCompanyId", "status");

-- CreateIndex
CREATE INDEX "plan_requests_status_createdAt_idx" ON "plan_requests"("status", "createdAt");
