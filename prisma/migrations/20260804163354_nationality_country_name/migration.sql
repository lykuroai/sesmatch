-- 外国籍フラグを国名明記方式に変更（未指定は日本国籍とみなす）
ALTER TABLE "engineers" DROP COLUMN "foreignNational";
ALTER TABLE "engineers" ADD COLUMN "nationality" TEXT;
