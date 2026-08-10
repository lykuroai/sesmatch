-- 新規企業30日間手数料無料の起点となる、運営承認（利用開始）日時
ALTER TABLE "companies" ADD COLUMN "approvedAt" TIMESTAMP(3);

-- 既存の開通済み企業は登録日時を承認日時とみなす（バックフィル）
UPDATE "companies" SET "approvedAt" = "createdAt" WHERE "status" = 'ACTIVE';
