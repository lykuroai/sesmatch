-- CreateEnum
CREATE TYPE "CompanyPlan" AS ENUM ('FREE', 'TRIAL', 'PRO');

-- CreateEnum
CREATE TYPE "PlanBillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('INVOICE', 'CARD');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'INVOICE',
ADD COLUMN     "plan" "CompanyPlan" NOT NULL DEFAULT 'FREE',
ADD COLUMN     "planBillingCycle" "PlanBillingCycle" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "planExpiresAt" TIMESTAMP(3),
ADD COLUMN     "planSeats" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "planStartedAt" TIMESTAMP(3);
