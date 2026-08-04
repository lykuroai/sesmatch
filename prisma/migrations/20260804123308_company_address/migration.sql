-- 企業所在地を追加（重複判定・審査に使用）
ALTER TABLE "companies" ADD COLUMN "address" TEXT;
