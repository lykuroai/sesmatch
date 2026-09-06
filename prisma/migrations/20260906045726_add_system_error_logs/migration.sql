-- CreateTable
CREATE TABLE "system_error_logs" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detail" TEXT,
    "tenantCompanyId" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_error_logs_createdAt_idx" ON "system_error_logs"("createdAt");

-- CreateIndex
CREATE INDEX "system_error_logs_source_message_notifiedAt_idx" ON "system_error_logs"("source", "message", "notifiedAt");
