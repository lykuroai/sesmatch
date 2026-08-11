-- 用語辞書（スキル・工程・業種の同義語。マッチングの名寄せに使用）
CREATE TYPE "AliasStatus" AS ENUM ('PROPOSED', 'APPROVED');

CREATE TABLE "skill_aliases" (
    "id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "canonical" TEXT NOT NULL,
    "status" "AliasStatus" NOT NULL DEFAULT 'APPROVED',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "skill_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "skill_aliases_alias_key" ON "skill_aliases"("alias");
