-- Preserve superseded measurement criteria so published academic records remain
-- explainable after an approved CLO's criteria are edited.
ALTER TABLE "clo_measurement_criteria" ADD COLUMN "supersededAt" TIMESTAMP(3);

DROP INDEX "clo_measurement_criteria_cloId_statement_key";

CREATE INDEX "clo_measurement_criteria_cloId_supersededAt_position_idx"
  ON "clo_measurement_criteria"("cloId", "supersededAt", "position");
