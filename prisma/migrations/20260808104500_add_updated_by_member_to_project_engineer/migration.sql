-- 最終更新者（人手操作のみ記録。登録者が空白時のエントリー受信通知宛先）
ALTER TABLE "engineers" ADD COLUMN "updatedByMemberId" TEXT;
ALTER TABLE "projects" ADD COLUMN "updatedByMemberId" TEXT;
