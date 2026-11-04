-- CreateTable
CREATE TABLE "skill_sheet_templates" (
    "id" TEXT NOT NULL,
    "tenantCompanyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "showCompanyName" BOOLEAN NOT NULL DEFAULT true,
    "footerNote" TEXT NOT NULL DEFAULT '',
    "sections" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_sheet_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "skill_sheet_templates_tenantCompanyId_idx" ON "skill_sheet_templates"("tenantCompanyId");
