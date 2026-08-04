-- 稼働開始後14日以内の契約終了: 状態=キャンセル・手数料0円（従来は REFUNDED・元金額のまま）
-- AlterEnum（型を作り直して CANCELLED を追加。同一トランザクション内で新値を使えるようにする）
CREATE TYPE "FeeStatus_new" AS ENUM ('CHARGED', 'FREE', 'REFUNDED', 'CANCELLED');
ALTER TABLE "platform_fees" ALTER COLUMN "status" TYPE "FeeStatus_new" USING ("status"::text::"FeeStatus_new");
ALTER TYPE "FeeStatus" RENAME TO "FeeStatus_old";
ALTER TYPE "FeeStatus_new" RENAME TO "FeeStatus";
DROP TYPE "FeeStatus_old";

-- 既存の返金済みデータはキャンセル・0円へ変換
UPDATE "platform_fees" SET "status" = 'CANCELLED', "feeExTaxYen" = 0 WHERE "status" = 'REFUNDED';
