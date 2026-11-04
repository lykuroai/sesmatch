-- CreateEnum
CREATE TYPE "SsoProvider" AS ENUM ('NONE', 'SAML', 'OIDC');

-- CreateTable
CREATE TABLE "user_mfa" (
    "userAccountId" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "enabledAt" TIMESTAMP(3),
    "backupCodes" JSONB NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_mfa_pkey" PRIMARY KEY ("userAccountId")
);

-- CreateTable
CREATE TABLE "mfa_challenges" (
    "id" TEXT NOT NULL,
    "userAccountId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_security_settings" (
    "companyId" TEXT NOT NULL,
    "mfaRequired" BOOLEAN NOT NULL DEFAULT false,
    "ipAllowList" JSONB NOT NULL DEFAULT '[]',
    "ssoProvider" "SsoProvider" NOT NULL DEFAULT 'NONE',
    "ssoConfigEncrypted" TEXT,
    "ssoRequired" BOOLEAN NOT NULL DEFAULT false,
    "updatedByMemberId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_security_settings_pkey" PRIMARY KEY ("companyId")
);

-- AddForeignKey
ALTER TABLE "user_mfa" ADD CONSTRAINT "user_mfa_userAccountId_fkey" FOREIGN KEY ("userAccountId") REFERENCES "user_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_security_settings" ADD CONSTRAINT "company_security_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
