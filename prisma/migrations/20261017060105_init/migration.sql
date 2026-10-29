-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'TUTOR', 'STUDENT');

-- CreateEnum
CREATE TYPE "OfferingStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ENROLLED', 'DROPPED', 'WITHDRAWN', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BloomLevel" AS ENUM ('REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYZE', 'EVALUATE', 'CREATE');

-- CreateEnum
CREATE TYPE "BloomDomain" AS ENUM ('COGNITIVE', 'PSYCHOMOTOR', 'AFFECTIVE');

-- CreateEnum
CREATE TYPE "AssessmentType" AS ENUM ('ASSIGNMENT', 'QUIZ', 'MID_EXAM', 'PROJECT', 'FINAL_EXAM');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('SUBMITTED', 'LATE', 'GRADED', 'RETURNED');

-- CreateEnum
CREATE TYPE "AttainmentScope" AS ENUM ('CLO', 'PLO');

-- CreateEnum
CREATE TYPE "AttainmentStatus" AS ENUM ('MET', 'AT_RISK', 'NOT_MET', 'INSUFFICIENT_DATA');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ASSESSMENT_PUBLISHED', 'DEADLINE_APPROACHING', 'GRADE_PUBLISHED', 'ENROLLMENT_CHANGED', 'COURSE_ASSIGNMENT', 'ATTAINMENT_UPDATE', 'IMPROVEMENT_PLAN', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "departmentId" UUID,
    "employeeNo" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ip" TEXT,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "hodName" TEXT,
    "contact" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "creditHours" INTEGER NOT NULL,
    "accreditationBody" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "semesters" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "semesters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "creditHours" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_offerings" (
    "id" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "semesterId" UUID NOT NULL,
    "tutorId" UUID NOT NULL,
    "sectionName" TEXT NOT NULL,
    "status" "OfferingStatus" NOT NULL DEFAULT 'PLANNED',
    "reportingPeriod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_offerings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "rollNo" TEXT NOT NULL,
    "programId" UUID NOT NULL,
    "batch" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "offeringId" UUID NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ENROLLED',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clos" (
    "id" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "bloomLevel" "BloomLevel" NOT NULL,
    "masteryThreshold" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" UUID NOT NULL,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "rejectionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plos" (
    "id" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "bloomDomain" "BloomDomain" NOT NULL,
    "accreditationRef" TEXT,
    "targetAttainment" DECIMAL(5,2) NOT NULL DEFAULT 65,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clo_plo_mappings" (
    "id" UUID NOT NULL,
    "cloId" UUID NOT NULL,
    "ploId" UUID NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clo_plo_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL,
    "offeringId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "type" "AssessmentType" NOT NULL,
    "instructions" TEXT,
    "maxMarks" DECIMAL(7,2) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "resultsPublishedAt" TIMESTAMP(3),
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_items" (
    "id" UUID NOT NULL,
    "assessmentId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "prompt" TEXT,
    "maxMarks" DECIMAL(7,2) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_item_clos" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "cloId" UUID NOT NULL,
    "weight" DECIMAL(7,3) NOT NULL DEFAULT 1,

    CONSTRAINT "assessment_item_clos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "assessmentId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "content" TEXT,
    "attachmentUrl" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "overallFeedback" TEXT,
    "gradedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_item_grades" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "marks" DECIMAL(7,2) NOT NULL,
    "feedback" TEXT,
    "gradedById" UUID NOT NULL,
    "gradedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submission_item_grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attainment_policies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attainment_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attainment_runs" (
    "id" UUID NOT NULL,
    "offeringId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "policySnapshot" JSONB NOT NULL,
    "reportingPeriod" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computedById" UUID,
    "isFrozen" BOOLEAN NOT NULL DEFAULT false,
    "frozenAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "attainment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clo_attainment" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "cloId" UUID NOT NULL,
    "cohortSize" INTEGER NOT NULL,
    "eligibleCount" INTEGER NOT NULL,
    "attainedCount" INTEGER NOT NULL,
    "meanScore" DECIMAL(6,2) NOT NULL,
    "attainmentPct" DECIMAL(6,2) NOT NULL,
    "targetPct" DECIMAL(6,2) NOT NULL,
    "status" "AttainmentStatus" NOT NULL,
    "missingEvidenceCount" INTEGER NOT NULL DEFAULT 0,
    "evidenceJson" JSONB,

    CONSTRAINT "clo_attainment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plo_attainment" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "ploId" UUID NOT NULL,
    "attainmentPct" DECIMAL(6,2) NOT NULL,
    "targetPct" DECIMAL(6,2) NOT NULL,
    "status" "AttainmentStatus" NOT NULL,
    "contributingClos" INTEGER NOT NULL,
    "weightedCohort" DECIMAL(12,2) NOT NULL,
    "evidenceJson" JSONB,

    CONSTRAINT "plo_attainment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'SYSTEM',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "deliveredAt" TIMESTAMP(3),
    "deliveryError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "improvement_action_plans" (
    "id" UUID NOT NULL,
    "offeringId" UUID NOT NULL,
    "cloId" UUID,
    "createdById" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'OPEN',
    "dueDate" DATE,
    "evaluation" TEXT,
    "evaluatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "improvement_action_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_employeeNo_key" ON "users"("employeeNo");

-- CreateIndex
CREATE INDEX "users_role_isActive_idx" ON "users"("role", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_revokedAt_idx" ON "refresh_tokens"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "programs_code_key" ON "programs"("code");

-- CreateIndex
CREATE INDEX "programs_departmentId_idx" ON "programs"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "semesters_name_key" ON "semesters"("name");

-- CreateIndex
CREATE INDEX "courses_programId_idx" ON "courses"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "courses_programId_code_key" ON "courses"("programId", "code");

-- CreateIndex
CREATE INDEX "course_offerings_semesterId_idx" ON "course_offerings"("semesterId");

-- CreateIndex
CREATE INDEX "course_offerings_tutorId_idx" ON "course_offerings"("tutorId");

-- CreateIndex
CREATE UNIQUE INDEX "course_offerings_courseId_semesterId_sectionName_key" ON "course_offerings"("courseId", "semesterId", "sectionName");

-- CreateIndex
CREATE UNIQUE INDEX "student_profiles_userId_key" ON "student_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "student_profiles_rollNo_key" ON "student_profiles"("rollNo");

-- CreateIndex
CREATE INDEX "student_profiles_programId_idx" ON "student_profiles"("programId");

-- CreateIndex
CREATE INDEX "enrollments_offeringId_status_idx" ON "enrollments"("offeringId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_studentId_offeringId_key" ON "enrollments"("studentId", "offeringId");

-- CreateIndex
CREATE INDEX "clos_courseId_approvalStatus_idx" ON "clos"("courseId", "approvalStatus");

-- CreateIndex
CREATE UNIQUE INDEX "clos_courseId_code_key" ON "clos"("courseId", "code");

-- CreateIndex
CREATE INDEX "plos_programId_idx" ON "plos"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "plos_programId_code_key" ON "plos"("programId", "code");

-- CreateIndex
CREATE INDEX "clo_plo_mappings_ploId_idx" ON "clo_plo_mappings"("ploId");

-- CreateIndex
CREATE UNIQUE INDEX "clo_plo_mappings_cloId_ploId_key" ON "clo_plo_mappings"("cloId", "ploId");

-- CreateIndex
CREATE INDEX "assessments_offeringId_status_idx" ON "assessments"("offeringId", "status");

-- CreateIndex
CREATE INDEX "assessment_items_assessmentId_idx" ON "assessment_items"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_items_assessmentId_label_key" ON "assessment_items"("assessmentId", "label");

-- CreateIndex
CREATE INDEX "assessment_item_clos_cloId_idx" ON "assessment_item_clos"("cloId");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_item_clos_itemId_cloId_key" ON "assessment_item_clos"("itemId", "cloId");

-- CreateIndex
CREATE INDEX "submissions_studentId_idx" ON "submissions"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_assessmentId_studentId_key" ON "submissions"("assessmentId", "studentId");

-- CreateIndex
CREATE INDEX "submission_item_grades_itemId_idx" ON "submission_item_grades"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "submission_item_grades_submissionId_itemId_key" ON "submission_item_grades"("submissionId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "attainment_policies_version_key" ON "attainment_policies"("version");

-- CreateIndex
CREATE INDEX "attainment_runs_offeringId_computedAt_idx" ON "attainment_runs"("offeringId", "computedAt");

-- CreateIndex
CREATE INDEX "clo_attainment_cloId_idx" ON "clo_attainment"("cloId");

-- CreateIndex
CREATE UNIQUE INDEX "clo_attainment_runId_cloId_key" ON "clo_attainment"("runId", "cloId");

-- CreateIndex
CREATE INDEX "plo_attainment_ploId_idx" ON "plo_attainment"("ploId");

-- CreateIndex
CREATE UNIQUE INDEX "plo_attainment_runId_ploId_key" ON "plo_attainment"("runId", "ploId");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_deliveryStatus_idx" ON "notifications"("deliveryStatus");

-- CreateIndex
CREATE INDEX "improvement_action_plans_offeringId_status_idx" ON "improvement_action_plans"("offeringId", "status");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_occurredAt_idx" ON "audit_logs"("entityType", "entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_occurredAt_idx" ON "audit_logs"("actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_occurredAt_idx" ON "audit_logs"("occurredAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "semesters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clos" ADD CONSTRAINT "clos_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clos" ADD CONSTRAINT "clos_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clos" ADD CONSTRAINT "clos_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plos" ADD CONSTRAINT "plos_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clo_plo_mappings" ADD CONSTRAINT "clo_plo_mappings_cloId_fkey" FOREIGN KEY ("cloId") REFERENCES "clos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clo_plo_mappings" ADD CONSTRAINT "clo_plo_mappings_ploId_fkey" FOREIGN KEY ("ploId") REFERENCES "plos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_items" ADD CONSTRAINT "assessment_items_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_item_clos" ADD CONSTRAINT "assessment_item_clos_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "assessment_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_item_clos" ADD CONSTRAINT "assessment_item_clos_cloId_fkey" FOREIGN KEY ("cloId") REFERENCES "clos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_item_grades" ADD CONSTRAINT "submission_item_grades_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_item_grades" ADD CONSTRAINT "submission_item_grades_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "assessment_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_item_grades" ADD CONSTRAINT "submission_item_grades_gradedById_fkey" FOREIGN KEY ("gradedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attainment_policies" ADD CONSTRAINT "attainment_policies_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attainment_runs" ADD CONSTRAINT "attainment_runs_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attainment_runs" ADD CONSTRAINT "attainment_runs_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "attainment_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attainment_runs" ADD CONSTRAINT "attainment_runs_computedById_fkey" FOREIGN KEY ("computedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clo_attainment" ADD CONSTRAINT "clo_attainment_runId_fkey" FOREIGN KEY ("runId") REFERENCES "attainment_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clo_attainment" ADD CONSTRAINT "clo_attainment_cloId_fkey" FOREIGN KEY ("cloId") REFERENCES "clos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plo_attainment" ADD CONSTRAINT "plo_attainment_runId_fkey" FOREIGN KEY ("runId") REFERENCES "attainment_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plo_attainment" ADD CONSTRAINT "plo_attainment_ploId_fkey" FOREIGN KEY ("ploId") REFERENCES "plos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_action_plans" ADD CONSTRAINT "improvement_action_plans_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_action_plans" ADD CONSTRAINT "improvement_action_plans_cloId_fkey" FOREIGN KEY ("cloId") REFERENCES "clos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_action_plans" ADD CONSTRAINT "improvement_action_plans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
