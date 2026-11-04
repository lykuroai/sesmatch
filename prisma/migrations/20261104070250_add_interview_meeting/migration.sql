-- CreateEnum
CREATE TYPE "MeetingProvider" AS ENUM ('NONE', 'JITSI');

-- AlterTable
ALTER TABLE "interviews" ADD COLUMN     "guestExpiresAt" TIMESTAMP(3),
ADD COLUMN     "guestTokenHash" TEXT,
ADD COLUMN     "meetingEndedAt" TIMESTAMP(3),
ADD COLUMN     "meetingProvider" "MeetingProvider" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "meetingRoomId" TEXT,
ADD COLUMN     "meetingStartedAt" TIMESTAMP(3);
