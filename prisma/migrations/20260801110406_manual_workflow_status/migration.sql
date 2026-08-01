-- CreateEnum
CREATE TYPE "EngineerWorkStatus" AS ENUM ('PROPOSING', 'WORKING');

-- CreateEnum
CREATE TYPE "ProjectWorkflowStatus" AS ENUM ('RECRUITING', 'CONTRACTED', 'ENDED');

-- AlterTable
ALTER TABLE "engineers" ADD COLUMN     "workStatus" "EngineerWorkStatus" NOT NULL DEFAULT 'PROPOSING';

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "workflowStatus" "ProjectWorkflowStatus" NOT NULL DEFAULT 'RECRUITING';
