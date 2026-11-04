-- CreateEnum
CREATE TYPE "SavedSearchKind" AS ENUM ('PROJECT', 'ENGINEER');

-- CreateEnum
CREATE TYPE "SavedSearchNotify" AS ENUM ('IMMEDIATE', 'DAILY', 'OFF');

-- CreateTable
CREATE TABLE "saved_searches" (
    "id" TEXT NOT NULL,
    "tenantCompanyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "kind" "SavedSearchKind" NOT NULL,
    "name" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "notify" "SavedSearchNotify" NOT NULL DEFAULT 'IMMEDIATE',
    "lastEvaluatedAt" TIMESTAMP(3),
    "lastNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_search_hits" (
    "savedSearchId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_search_hits_pkey" PRIMARY KEY ("savedSearchId","targetId")
);

-- CreateIndex
CREATE INDEX "saved_searches_tenantCompanyId_idx" ON "saved_searches"("tenantCompanyId");

-- AddForeignKey
ALTER TABLE "saved_search_hits" ADD CONSTRAINT "saved_search_hits_savedSearchId_fkey" FOREIGN KEY ("savedSearchId") REFERENCES "saved_searches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
