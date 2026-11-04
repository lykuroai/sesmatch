-- AlterTable
ALTER TABLE "ingestion_jobs" ADD COLUMN     "batchId" TEXT;

-- CreateIndex
CREATE INDEX "ingestion_jobs_tenantCompanyId_batchId_idx" ON "ingestion_jobs"("tenantCompanyId", "batchId");
