-- 基本契約第4条（契約形態・労働者派遣の遵守事項）対応

-- Company: 労働者派遣事業の許可情報（供給側企業）
ALTER TABLE "companies" ADD COLUMN "dispatchLicenseNumber" TEXT;
ALTER TABLE "companies" ADD COLUMN "dispatchLicenseExpiry" TIMESTAMP(3);
ALTER TABLE "companies" ADD COLUMN "dispatchManagerName" TEXT;

-- Project: 契約形態を必須化（既存の未設定は準委任として扱う）
UPDATE "projects" SET "contractType" = '準委任' WHERE "contractType" IS NULL;
ALTER TABLE "projects" ALTER COLUMN "contractType" SET NOT NULL;
ALTER TABLE "projects" ALTER COLUMN "contractType" SET DEFAULT '準委任';

-- Project: 労働者派遣の場合の必須項目
ALTER TABLE "projects" ADD COLUMN "dispatchConflictDate" TIMESTAMP(3);
ALTER TABLE "projects" ADD COLUMN "dispatchDemandManager" TEXT;
ALTER TABLE "projects" ADD COLUMN "dispatchProhibitedConfirmed" BOOLEAN NOT NULL DEFAULT false;
