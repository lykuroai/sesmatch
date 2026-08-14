-- CreateTable
CREATE TABLE "inquiries" (
    "id" TEXT NOT NULL,
    "tenantCompanyId" TEXT NOT NULL,
    "memberId" TEXT,
    "category" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inquiries_pkey" PRIMARY KEY ("id")
);
