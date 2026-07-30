-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('CORPORATION', 'SOLE_PROPRIETOR');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('APPLIED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('OWNER', 'ADMIN', 'SALES', 'HR_MANAGER', 'PROJECT_MANAGER', 'CONTRACT', 'ACCOUNTING', 'PRIVACY_OFFICER', 'AUDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "AffiliationType" AS ENUM ('EMPLOYEE', 'AFFILIATED', 'FREELANCER', 'SUBTIER1');

-- CreateEnum
CREATE TYPE "RemoteLevel" AS ENUM ('R0', 'R1', 'R2', 'R3', 'R4', 'R5');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "WorkAuthStatus" AS ENUM ('NOT_REQUIRED', 'UNVERIFIED', 'VERIFIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SkillCategory" AS ENUM ('LANGUAGE', 'FRAMEWORK', 'DATABASE', 'CLOUD', 'OS', 'TOOL', 'CERTIFICATION');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('ENGINEER_SHEET', 'PROJECT_DESCRIPTION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "IngestionStatus" AS ENUM ('RECEIVED', 'MASKING', 'EXTRACTING', 'REVIEW_REQUIRED', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyType" "CompanyType" NOT NULL,
    "corporateNumber" TEXT,
    "status" "CompanyStatus" NOT NULL DEFAULT 'APPLIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_accounts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_members" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userAccountId" TEXT NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_member_roles" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "role" "RoleCode" NOT NULL,

    CONSTRAINT "company_member_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userAccountId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineers" (
    "id" TEXT NOT NULL,
    "tenantCompanyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ageBand" INTEGER NOT NULL,
    "affiliationType" "AffiliationType" NOT NULL,
    "residenceCity" TEXT,
    "nearestStation" TEXT,
    "availableFrom" TIMESTAMP(3),
    "availabilityRate" INTEGER NOT NULL DEFAULT 100,
    "desiredRateYen" INTEGER NOT NULL,
    "commuteMaxMinutes" INTEGER,
    "maxOnsiteDaysPerWeek" INTEGER,
    "remotePreference" "RemoteLevel" NOT NULL DEFAULT 'R0',
    "travelOk" BOOLEAN NOT NULL DEFAULT false,
    "workAuthStatus" "WorkAuthStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "workAuthExpiry" TIMESTAMP(3),
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "summary" TEXT NOT NULL DEFAULT '',
    "processes" TEXT[],
    "roles" TEXT[],
    "industries" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engineers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineer_skills" (
    "id" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "category" "SkillCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "engineer_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_consents" (
    "id" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "purposes" TEXT[],
    "validUntil" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "tenantCompanyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "anonymousSummary" TEXT NOT NULL,
    "industry" TEXT,
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "longTerm" BOOLEAN NOT NULL DEFAULT false,
    "locationCity" TEXT,
    "nearestStation" TEXT,
    "onsiteDaysPerWeek" INTEGER NOT NULL DEFAULT 5,
    "remoteLevel" "RemoteLevel" NOT NULL DEFAULT 'R0',
    "rateMinYen" INTEGER,
    "rateMaxYen" INTEGER NOT NULL,
    "contractType" TEXT,
    "allowSubtier" BOOLEAN NOT NULL DEFAULT false,
    "acceptedTypes" "AffiliationType"[],
    "interviewCount" INTEGER NOT NULL DEFAULT 1,
    "processes" TEXT[],
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_skills" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "minMonths" INTEGER,

    CONSTRAINT "project_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matching_results" (
    "id" TEXT NOT NULL,
    "tenantCompanyId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "score" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "matchedConditions" TEXT[],
    "missingConditions" TEXT[],
    "warnings" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matching_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_documents" (
    "id" TEXT NOT NULL,
    "tenantCompanyId" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL DEFAULT 'UNKNOWN',
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_jobs" (
    "id" TEXT NOT NULL,
    "tenantCompanyId" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "status" "IngestionStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingestion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_results" (
    "id" TEXT NOT NULL,
    "ingestionJobId" TEXT NOT NULL,
    "maskedText" TEXT NOT NULL,
    "extractedJson" JSONB NOT NULL,
    "confirmedJson" JSONB,
    "confirmedByMemberId" TEXT,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "extraction_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pii_token_maps" (
    "id" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "originalValue" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pii_token_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "tenantCompanyId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_email_key" ON "user_accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "company_members_companyId_userAccountId_key" ON "company_members"("companyId", "userAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "company_member_roles_memberId_role_key" ON "company_member_roles"("memberId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE UNIQUE INDEX "engineers_tenantCompanyId_code_key" ON "engineers"("tenantCompanyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "engineer_skills_engineerId_name_key" ON "engineer_skills"("engineerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "projects_tenantCompanyId_code_key" ON "projects"("tenantCompanyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "project_skills_projectId_name_key" ON "project_skills"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_results_ingestionJobId_key" ON "extraction_results"("ingestionJobId");

-- CreateIndex
CREATE INDEX "audit_events_tenantCompanyId_createdAt_idx" ON "audit_events"("tenantCompanyId", "createdAt");

-- AddForeignKey
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_userAccountId_fkey" FOREIGN KEY ("userAccountId") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_member_roles" ADD CONSTRAINT "company_member_roles_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userAccountId_fkey" FOREIGN KEY ("userAccountId") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineers" ADD CONSTRAINT "engineers_tenantCompanyId_fkey" FOREIGN KEY ("tenantCompanyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineer_skills" ADD CONSTRAINT "engineer_skills_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "engineers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_consents" ADD CONSTRAINT "person_consents_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "engineers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenantCompanyId_fkey" FOREIGN KEY ("tenantCompanyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_skills" ADD CONSTRAINT "project_skills_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "source_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_results" ADD CONSTRAINT "extraction_results_ingestionJobId_fkey" FOREIGN KEY ("ingestionJobId") REFERENCES "ingestion_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pii_token_maps" ADD CONSTRAINT "pii_token_maps_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "source_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
