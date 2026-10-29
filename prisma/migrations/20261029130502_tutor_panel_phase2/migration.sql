-- CreateEnum
CREATE TYPE "LatePolicy" AS ENUM ('ACCEPT', 'REJECT', 'MARK_LATE');

-- AlterEnum
ALTER TYPE "AssessmentStatus" ADD VALUE 'ARCHIVED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AssessmentType" ADD VALUE 'LAB';
ALTER TYPE "AssessmentType" ADD VALUE 'PRESENTATION';
ALTER TYPE "AssessmentType" ADD VALUE 'OTHER';

-- AlterTable
ALTER TABLE "assessments" ADD COLUMN     "latePolicy" "LatePolicy" NOT NULL DEFAULT 'MARK_LATE',
ADD COLUMN     "passingMarks" DECIMAL(7,2),
ADD COLUMN     "submissionFormat" TEXT;

-- AlterTable
ALTER TABLE "clos" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "course_materials" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "improvement_action_plans" ADD COLUMN     "followUp" TEXT,
ADD COLUMN     "gapDescription" TEXT;

-- AlterTable
ALTER TABLE "rubric_criteria" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "submission_criterion_grades" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "grade_changes" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "itemId" UUID,
    "actorId" UUID,
    "previousMarks" DECIMAL(7,2),
    "newMarks" DECIMAL(7,2) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "grade_changes_submissionId_createdAt_idx" ON "grade_changes"("submissionId", "createdAt");

-- CreateIndex
CREATE INDEX "grade_changes_itemId_idx" ON "grade_changes"("itemId");

-- AddForeignKey
ALTER TABLE "grade_changes" ADD CONSTRAINT "grade_changes_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_changes" ADD CONSTRAINT "grade_changes_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "assessment_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_changes" ADD CONSTRAINT "grade_changes_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
