-- 企業申込のメール確認を「6桁コード」から「登録用URL（トークン・24時間有効）」へ変更（2026-11-04）。
-- 既存行は15分有効の確認コードで一時データのため、列の入れ替え前に削除する
DELETE FROM "email_verifications";

-- AlterTable
ALTER TABLE "email_verifications" DROP COLUMN "code",
ADD COLUMN     "token" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "email_verifications_token_key" ON "email_verifications"("token");
