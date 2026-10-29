-- Criterion-level rubric evidence. Item marks remain the CLO evidence value;
-- criterion marks explain how that value was determined.
CREATE TABLE "rubric_criteria" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "itemId" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "maxMarks" DECIMAL(7,2) NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "rubric_criteria_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rubric_criteria_itemId_label_key" UNIQUE ("itemId", "label"),
  CONSTRAINT "rubric_criteria_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "assessment_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rubric_criteria_max_marks_positive" CHECK ("maxMarks" > 0)
);
CREATE INDEX "rubric_criteria_itemId_idx" ON "rubric_criteria"("itemId");

CREATE TABLE "submission_criterion_grades" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "submissionId" UUID NOT NULL,
  "criterionId" UUID NOT NULL,
  "marks" DECIMAL(7,2) NOT NULL,
  "feedback" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "submission_criterion_grades_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "submission_criterion_grades_submissionId_criterionId_key" UNIQUE ("submissionId", "criterionId"),
  CONSTRAINT "submission_criterion_grades_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "submission_criterion_grades_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "rubric_criteria"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "submission_criterion_marks_nonnegative" CHECK ("marks" >= 0)
);
CREATE INDEX "submission_criterion_grades_criterionId_idx" ON "submission_criterion_grades"("criterionId");

-- A criterion mark may not exceed its criterion maximum, and the criterion must
-- belong to an item of the same assessment as the submission.
CREATE OR REPLACE FUNCTION assert_criterion_grade_bounds() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_max numeric;
BEGIN
  SELECT rc."maxMarks" INTO v_max
  FROM rubric_criteria rc
  JOIN assessment_items i ON i.id = rc."itemId"
  JOIN assessments a ON a.id = i."assessmentId"
  JOIN submissions s ON s."assessmentId" = a.id
  WHERE rc.id = NEW."criterionId" AND s.id = NEW."submissionId";

  IF v_max IS NULL THEN
    RAISE EXCEPTION 'rubric criterion % does not belong to the submission assessment', NEW."criterionId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.marks > v_max THEN
    RAISE EXCEPTION 'criterion marks % exceed maximum %', NEW.marks, v_max
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER criterion_grade_bounds
  BEFORE INSERT OR UPDATE ON "submission_criterion_grades"
  FOR EACH ROW EXECUTE FUNCTION assert_criterion_grade_bounds();
