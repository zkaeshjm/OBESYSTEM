-- CreateTable
CREATE TABLE "clo_measurement_criteria" (
    "id" UUID NOT NULL,
    "cloId" UUID NOT NULL,
    "statement" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clo_measurement_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clo_measurement_criteria_cloId_idx" ON "clo_measurement_criteria"("cloId");

-- CreateIndex
CREATE UNIQUE INDEX "clo_measurement_criteria_cloId_statement_key" ON "clo_measurement_criteria"("cloId", "statement");

-- AddForeignKey
ALTER TABLE "clo_measurement_criteria" ADD CONSTRAINT "clo_measurement_criteria_cloId_fkey" FOREIGN KEY ("cloId") REFERENCES "clos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
