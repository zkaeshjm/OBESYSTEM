-- CreateEnum
CREATE TYPE "GradeState" AS ENUM ('GRADED', 'EXCUSED', 'INCOMPLETE');

-- AlterTable
ALTER TABLE "submission_item_grades" ADD COLUMN     "state" "GradeState" NOT NULL DEFAULT 'GRADED';
