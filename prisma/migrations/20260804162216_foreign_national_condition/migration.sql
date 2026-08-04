-- 案件の外国籍不可条件と人材の外国籍フラグ
ALTER TABLE "engineers" ADD COLUMN "foreignNational" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "projects" ADD COLUMN "noForeignNational" BOOLEAN NOT NULL DEFAULT false;
