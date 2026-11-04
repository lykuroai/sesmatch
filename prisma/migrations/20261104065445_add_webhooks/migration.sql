-- CreateEnum
CREATE TYPE "WebhookProvider" AS ENUM ('SLACK', 'TEAMS', 'GENERIC');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "tenantCompanyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "urlEncrypted" TEXT NOT NULL,
    "urlHint" TEXT NOT NULL,
    "provider" "WebhookProvider" NOT NULL DEFAULT 'GENERIC',
    "events" JSONB NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'ACTIVE',
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "lastDeliveredAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhooks_tenantCompanyId_idx" ON "webhooks"("tenantCompanyId");
