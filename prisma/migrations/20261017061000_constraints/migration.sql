-- Database-level integrity rules that Prisma cannot express declaratively.
-- Kept in a separate migration so the generated schema remains reproducible.

-- Exactly one active semester and one active attainment policy.
CREATE UNIQUE INDEX "semester_one_active" ON "semesters" ("isActive") WHERE "isActive" = true;
CREATE UNIQUE INDEX "attainment_policy_one_active" ON "attainment_policies" ("isActive") WHERE "isActive" = true;

-- Outcome policy bounds.
ALTER TABLE "clos" ADD CONSTRAINT "clo_mastery_threshold_range"
  CHECK ("masteryThreshold" >= 0 AND "masteryThreshold" <= 100);
ALTER TABLE "plos" ADD CONSTRAINT "plo_target_attainment_range"
  CHECK ("targetAttainment" >= 0 AND "targetAttainment" <= 100);
ALTER TABLE "clo_plo_mappings" ADD CONSTRAINT "clo_plo_weight_range"
  CHECK (weight BETWEEN 1 AND 3);
ALTER TABLE "assessment_item_clos" ADD CONSTRAINT "assessment_item_clo_weight_positive"
  CHECK (weight > 0);
ALTER TABLE "assessment_items" ADD CONSTRAINT "assessment_item_marks_positive"
  CHECK ("maxMarks" > 0);
ALTER TABLE "assessments" ADD CONSTRAINT "assessment_marks_positive"
  CHECK ("maxMarks" > 0);
ALTER TABLE "submission_item_grades" ADD CONSTRAINT "grade_marks_nonnegative"
  CHECK (marks >= 0);
ALTER TABLE "course_offerings" ADD CONSTRAINT "offering_section_name_present"
  CHECK (length(trim("sectionName")) > 0);
ALTER TABLE "improvement_action_plans" ADD CONSTRAINT "plan_description_present"
  CHECK (length(trim(description)) > 0);

-- A course offering may only be assigned to a tutor account.
CREATE OR REPLACE FUNCTION assert_offering_tutor_role() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_role text;
BEGIN
  SELECT role::text INTO v_role FROM users WHERE id = NEW."tutorId";
  IF v_role IS NULL OR v_role <> 'TUTOR' THEN
    RAISE EXCEPTION 'course offering tutor % is not a TUTOR', NEW."tutorId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER offering_tutor_role
  BEFORE INSERT OR UPDATE OF "tutorId" ON "course_offerings"
  FOR EACH ROW EXECUTE FUNCTION assert_offering_tutor_role();

-- A grade may only reference an item belonging to the submission's assessment,
-- and marks may never exceed that item's maximum.
CREATE OR REPLACE FUNCTION assert_grade_item_and_max() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_max numeric;
BEGIN
  SELECT i."maxMarks" INTO v_max
  FROM assessment_items i
  JOIN assessments a ON a.id = i."assessmentId"
  JOIN submissions s ON s."assessmentId" = a.id
  WHERE i.id = NEW."itemId" AND s.id = NEW."submissionId";

  IF v_max IS NULL THEN
    RAISE EXCEPTION 'grade item % does not belong to the submission assessment', NEW."itemId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.marks > v_max THEN
    RAISE EXCEPTION 'marks % exceed item maximum %', NEW.marks, v_max
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER grade_item_and_max
  BEFORE INSERT OR UPDATE ON "submission_item_grades"
  FOR EACH ROW EXECUTE FUNCTION assert_grade_item_and_max();

-- An assessment item may only be mapped to a CLO of the course that the
-- assessment's offering belongs to. Prevents cross-course outcome evidence.
CREATE OR REPLACE FUNCTION assert_item_clo_same_course() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM assessment_items i
    JOIN assessments a ON a.id = i."assessmentId"
    JOIN course_offerings o ON o.id = a."offeringId"
    JOIN clos c ON c.id = NEW."cloId"
    WHERE i.id = NEW."itemId" AND c."courseId" = o."courseId"
  ) THEN
    RAISE EXCEPTION 'CLO % does not belong to the course of item %', NEW."cloId", NEW."itemId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER item_clo_same_course
  BEFORE INSERT OR UPDATE ON "assessment_item_clos"
  FOR EACH ROW EXECUTE FUNCTION assert_item_clo_same_course();

-- A submission may only exist for a student enrolled in the offering.
CREATE OR REPLACE FUNCTION assert_submission_enrollment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM assessments a
    JOIN enrollments e ON e."offeringId" = a."offeringId"
    WHERE a.id = NEW."assessmentId"
      AND e."studentId" = NEW."studentId"
      AND e.status IN ('ENROLLED', 'COMPLETED')
  ) THEN
    RAISE EXCEPTION 'student % is not enrolled in the assessment offering', NEW."studentId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER submission_enrollment
  BEFORE INSERT ON "submissions"
  FOR EACH ROW EXECUTE FUNCTION assert_submission_enrollment();

-- CLO-to-PLO mappings must belong to the same programme as the CLO's course.
CREATE OR REPLACE FUNCTION assert_clo_plo_same_program() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM clos c
    JOIN courses co ON co.id = c."courseId"
    JOIN plos p ON p.id = NEW."ploId"
    WHERE c.id = NEW."cloId" AND p."programId" = co."programId"
  ) THEN
    RAISE EXCEPTION 'CLO % and PLO % belong to different programmes', NEW."cloId", NEW."ploId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER clo_plo_same_program
  BEFORE INSERT OR UPDATE ON "clo_plo_mappings"
  FOR EACH ROW EXECUTE FUNCTION assert_clo_plo_same_program();

-- Notifications always carry a real recipient and a consistent delivery state.
ALTER TABLE "notifications" ADD CONSTRAINT "notification_delivered_fields"
  CHECK (
    ("deliveryStatus" <> 'DELIVERED') OR ("deliveredAt" IS NOT NULL)
  );
