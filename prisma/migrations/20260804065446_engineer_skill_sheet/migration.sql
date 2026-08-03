-- 人材に業務経歴書（スキルシート）原本を紐づける
ALTER TABLE "engineers" ADD COLUMN "skillSheetDocumentId" TEXT;

-- AddForeignKey
ALTER TABLE "engineers" ADD CONSTRAINT "engineers_skillSheetDocumentId_fkey"
  FOREIGN KEY ("skillSheetDocumentId") REFERENCES "source_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
