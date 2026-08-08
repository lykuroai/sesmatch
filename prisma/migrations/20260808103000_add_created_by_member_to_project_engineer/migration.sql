-- 登録者（エントリー受信通知の宛先）。既存データは NULL のまま
ALTER TABLE "engineers" ADD COLUMN "createdByMemberId" TEXT;
ALTER TABLE "projects" ADD COLUMN "createdByMemberId" TEXT;
