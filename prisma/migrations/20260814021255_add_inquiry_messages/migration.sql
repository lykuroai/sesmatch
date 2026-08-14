-- CreateTable
CREATE TABLE "inquiry_messages" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "fromOperator" BOOLEAN NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inquiry_messages_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "inquiry_messages" ADD CONSTRAINT "inquiry_messages_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "inquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
