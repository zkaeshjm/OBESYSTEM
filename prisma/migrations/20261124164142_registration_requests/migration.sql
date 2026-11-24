-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "registration_requests" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "departmentId" UUID,
    "employeeNo" TEXT,
    "rollNo" TEXT,
    "programId" UUID,
    "batch" TEXT,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "decisionNote" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registration_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "registration_requests_status_createdAt_idx" ON "registration_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "registration_requests_email_status_idx" ON "registration_requests"("email", "status");

-- Only one open application per email may exist at a time. A rejected request
-- stops blocking the address, so the applicant may apply again later.
CREATE UNIQUE INDEX "registration_requests_email_pending_key"
  ON "registration_requests" ("email")
  WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "registration_requests" ADD CONSTRAINT "registration_requests_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_requests" ADD CONSTRAINT "registration_requests_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_requests" ADD CONSTRAINT "registration_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_requests" ADD CONSTRAINT "registration_requests_createdUserId_fkey" FOREIGN KEY ("createdUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
