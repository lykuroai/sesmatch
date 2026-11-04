-- AlterTable
ALTER TABLE "entries" ADD COLUMN     "scoutBatchId" TEXT;

-- AlterTable
ALTER TABLE "entry_messages" ADD COLUMN     "readAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "scout_batches" (
    "id" TEXT NOT NULL,
    "tenantCompanyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "templateBody" TEXT NOT NULL,
    "requestedCount" INTEGER NOT NULL,
    "createdCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scout_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scout_batches_tenantCompanyId_idx" ON "scout_batches"("tenantCompanyId");

-- CreateIndex
CREATE INDEX "entries_scoutBatchId_idx" ON "entries"("scoutBatchId");

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_scoutBatchId_fkey" FOREIGN KEY ("scoutBatchId") REFERENCES "scout_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
