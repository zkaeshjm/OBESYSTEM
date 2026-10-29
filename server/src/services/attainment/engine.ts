import type { AttainmentPolicy } from './policy.js';

export type AttainmentStatusResult = 'MET' | 'AT_RISK' | 'NOT_MET' | 'INSUFFICIENT_DATA';
export type GradeStateInput = 'GRADED' | 'EXCUSED' | 'INCOMPLETE';

export interface CloInput {
  id: string;
  code: string;
  masteryThreshold: number;
  ploMappings: Array<{ ploId: string; weight: number }>;
}

export interface PloInput {
  id: string;
  code: string;
  targetAttainment: number;
}

export interface ItemInput {
  id: string;
  maxMarks: number;
  cloMappings: Array<{ cloId: string; weight: number }>;
}

export interface GradeInput {
  itemId: string;
  marks: number;
  state: GradeStateInput;
}

export interface StudentInput {
  id: string;
  name: string;
  rollNo: string;
  grades: GradeInput[];
}

export interface EngineInput {
  clos: CloInput[];
  plos: PloInput[];
  items: ItemInput[];
  students: StudentInput[];
  policy: AttainmentPolicy;
}

export interface CloResult {
  cloId: string;
  code: string;
  cohortSize: number;
  eligibleCount: number;
  attainedCount: number;
  meanScore: number;
  attainmentPct: number;
  targetPct: number;
  masteryThreshold: number;
  status: AttainmentStatusResult;
  missingEvidenceCount: number;
  evidence: Record<string, unknown>;
}

export interface PloResult {
  ploId: string;
  code: string;
  attainmentPct: number;
  targetPct: number;
  status: AttainmentStatusResult;
  contributingClos: number;
  weightedCohort: number;
  evidence: Record<string, unknown>;
}

export interface StudentCloScore {
  studentId: string;
  cloId: string;
  score: number;
  evidenceWeight: number;
  mastered: boolean;
}

export interface EngineOutput {
  cloResults: CloResult[];
  ploResults: PloResult[];
  studentScores: StudentCloScore[];
}

export class EngineInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineInputError';
  }
}

const STATUS_ORDER: Record<AttainmentStatusResult, number> = {
  MET: 0,
  AT_RISK: 1,
  NOT_MET: 2,
  INSUFFICIENT_DATA: 3,
};

export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function decideStatus(
  attainmentPct: number,
  targetPct: number,
  band: number,
  eligible: boolean
): AttainmentStatusResult {
  if (!eligible) return 'INSUFFICIENT_DATA';
  if (attainmentPct >= targetPct) return 'MET';
  if (attainmentPct >= targetPct - band) return 'AT_RISK';
  return 'NOT_MET';
}

function assertFinite(value: number, label: string) {
  if (!Number.isFinite(value)) throw new EngineInputError(`${label} must be a finite number`);
}

/**
 * Deterministic CLO/PLO attainment calculation. Pure function: no I/O, no clock.
 * The caller persists the returned results together with the policy snapshot.
 */
export function computeAttainment(input: EngineInput): EngineOutput {
  const { policy } = input;
  if (input.students.length === 0) {
    return {
      cloResults: input.clos.map((clo) => ({
        cloId: clo.id,
        code: clo.code,
        cohortSize: 0,
        eligibleCount: 0,
        attainedCount: 0,
        meanScore: 0,
        attainmentPct: 0,
        targetPct: policy.cohortAttainmentTarget,
        masteryThreshold: clo.masteryThreshold,
        status: 'INSUFFICIENT_DATA',
        missingEvidenceCount: 0,
        evidence: { reason: 'no_enrolled_students' },
      })),
      ploResults: input.plos.map((plo) => ({
        ploId: plo.id,
        code: plo.code,
        attainmentPct: 0,
        targetPct: plo.targetAttainment,
        status: 'INSUFFICIENT_DATA',
        contributingClos: 0,
        weightedCohort: 0,
        evidence: { reason: 'no_enrolled_students' },
      })),
      studentScores: [],
    };
  }

  // Validate the evidence graph once, so a malformed input fails loudly rather
  // than producing a plausible but wrong attainment figure.
  const itemById = new Map(input.items.map((item) => [item.id, item]));
  for (const item of input.items) {
    assertFinite(item.maxMarks, `item ${item.id} maxMarks`);
    if (item.maxMarks <= 0) throw new EngineInputError(`item ${item.id} maxMarks must be > 0`);
    for (const mapping of item.cloMappings) {
      assertFinite(mapping.weight, `item ${item.id} CLO weight`);
      if (mapping.weight <= 0) {
        throw new EngineInputError(`item ${item.id} CLO weight must be > 0`);
      }
    }
  }

  for (const student of input.students) {
    const seen = new Set<string>();
    for (const grade of student.grades) {
      const item = itemById.get(grade.itemId);
      if (!item) {
        throw new EngineInputError(`student ${student.id} has a grade for unknown item ${grade.itemId}`);
      }
      if (seen.has(grade.itemId)) {
        throw new EngineInputError(`student ${student.id} has duplicate grades for item ${grade.itemId}`);
      }
      seen.add(grade.itemId);
      assertFinite(grade.marks, `student ${student.id} marks`);
      if (grade.marks < 0) throw new EngineInputError(`student ${student.id} marks must be >= 0`);
      if (grade.marks > item.maxMarks) {
        throw new EngineInputError(
          `student ${student.id} marks ${grade.marks} exceed item ${grade.itemId} maximum ${item.maxMarks}`
        );
      }
    }
  }

  const cohortSize = input.students.length;

  const cloResults: CloResult[] = input.clos.map((clo) => {
    const masteryThreshold = clo.masteryThreshold ?? policy.cloMasteryThreshold;
    const cloItems = input.items.filter((item) =>
      item.cloMappings.some((mapping) => mapping.cloId === clo.id)
    );
    const itemWeightForClo = (itemId: string) =>
      cloItems
        .find((item) => item.id === itemId)
        ?.cloMappings.find((mapping) => mapping.cloId === clo.id)?.weight ?? 0;

    const scores: Array<{ studentId: string; score: number; weight: number }> = [];

    for (const student of input.students) {
      const gradeByItem = new Map(student.grades.map((grade) => [grade.itemId, grade]));
      let weightedScore = 0;
      let weightSum = 0;

      for (const item of cloItems) {
        const mappingWeight = itemWeightForClo(item.id);
        if (mappingWeight <= 0) continue;
        const grade = gradeByItem.get(item.id);
        if (!grade) {
          if (policy.missingEvidence === 'zero') {
            weightSum += mappingWeight;
          }
          continue;
        }
        if (grade.state === 'EXCUSED') continue;
        if (grade.state === 'INCOMPLETE') {
          if (policy.missingEvidence === 'zero') weightSum += mappingWeight;
          continue;
        }
        const pct = (grade.marks / item.maxMarks) * 100;
        weightedScore += pct * mappingWeight;
        weightSum += mappingWeight;
      }

      if (weightSum > 0) {
        scores.push({
          studentId: student.id,
          score: weightedScore / weightSum,
          weight: weightSum,
        });
      }
    }

    const eligibleCount = scores.length;
    const attainedCount = scores.filter((entry) => entry.score >= masteryThreshold).length;
    const meanScore =
      eligibleCount === 0 ? 0 : scores.reduce((sum, entry) => sum + entry.score, 0) / eligibleCount;
    const attainmentPct = eligibleCount === 0 ? 0 : (attainedCount / eligibleCount) * 100;
    const eligible = eligibleCount >= policy.minCohortSize && eligibleCount > 0;

    return {
      cloId: clo.id,
      code: clo.code,
      cohortSize,
      eligibleCount,
      attainedCount,
      meanScore: roundTo(meanScore, policy.rounding),
      attainmentPct: roundTo(attainmentPct, policy.rounding),
      targetPct: policy.cohortAttainmentTarget,
      masteryThreshold,
      status: decideStatus(attainmentPct, policy.cohortAttainmentTarget, policy.atRiskBand, eligible),
      missingEvidenceCount: cohortSize - eligibleCount,
      evidence: {
        method: 'student_mastery_membership',
        missingEvidence: policy.missingEvidence,
        excusedEvidence: 'exclude',
        assessedItemIds: cloItems.filter((item) => item.cloMappings.length > 0).map((item) => item.id),
        eligibleStudentIds: scores.map((entry) => entry.studentId),
        minCohortSize: policy.minCohortSize,
      },
    };
  });

  const studentScores: StudentCloScore[] = [];

  // Recompute student scores once per CLO for the progress endpoint. The cost is
  // bounded by cohort × CLO × items and this endpoint is not on the hot path.
  for (const result of cloResults) {
    const clo = input.clos.find((entry) => entry.id === result.cloId)!;
    const cloItems = input.items.filter((item) =>
      item.cloMappings.some((mapping) => mapping.cloId === clo.id)
    );
    for (const student of input.students) {
      const gradeByItem = new Map(student.grades.map((grade) => [grade.itemId, grade]));
      let weightedScore = 0;
      let weightSum = 0;
      for (const item of cloItems) {
        const mappingWeight =
          item.cloMappings.find((mapping) => mapping.cloId === clo.id)?.weight ?? 0;
        if (mappingWeight <= 0) continue;
        const grade = gradeByItem.get(item.id);
        if (!grade || grade.state === 'EXCUSED') continue;
        if (grade.state === 'INCOMPLETE' && policy.missingEvidence === 'exclude') continue;
        const pct = grade.state === 'INCOMPLETE' ? 0 : (grade.marks / item.maxMarks) * 100;
        weightedScore += pct * mappingWeight;
        weightSum += mappingWeight;
      }
      if (weightSum > 0) {
        studentScores.push({
          studentId: student.id,
          cloId: clo.id,
          score: roundTo(weightedScore / weightSum, policy.rounding),
          evidenceWeight: weightSum,
          mastered: weightedScore / weightSum >= result.masteryThreshold,
        });
      }
    }
  }

  const ploIds = new Set(input.plos.map((plo) => plo.id));
  const ploResults: PloResult[] = input.plos.map((plo) => {
    const contributions: Array<{ cloId: string; attainmentPct: number; weight: number; eligible: number }> = [];

    for (const clo of input.clos) {
      const mapping = clo.ploMappings.find((entry) => entry.ploId === plo.id);
      if (!mapping || !ploIds.has(plo.id)) continue;
      const result = cloResults.find((entry) => entry.cloId === clo.id);
      if (!result || result.status === 'INSUFFICIENT_DATA' || result.eligibleCount === 0) continue;
      const weight =
        policy.ploWeighting === 'mapping_weight_and_cohort'
          ? mapping.weight * result.eligibleCount
          : mapping.weight;
      contributions.push({
        cloId: clo.id,
        attainmentPct: result.attainmentPct,
        weight,
        eligible: result.eligibleCount,
      });
    }

    const totalWeight = contributions.reduce((sum, entry) => sum + entry.weight, 0);
    const weightedCohort = contributions.reduce((sum, entry) => sum + entry.eligible, 0);
    const attainmentPct =
      totalWeight === 0
        ? 0
        : contributions.reduce((sum, entry) => sum + entry.attainmentPct * entry.weight, 0) /
          totalWeight;
    const eligible = contributions.length > 0 && totalWeight > 0;

    return {
      ploId: plo.id,
      code: plo.code,
      attainmentPct: roundTo(attainmentPct, policy.rounding),
      targetPct: plo.targetAttainment,
      status: decideStatus(attainmentPct, plo.targetAttainment, policy.atRiskBand, eligible),
      contributingClos: contributions.length,
      weightedCohort,
      evidence: {
        method: 'weighted_clo_aggregation',
        ploWeighting: policy.ploWeighting,
        contributions: contributions.map((entry) => ({
          cloId: entry.cloId,
          attainmentPct: entry.attainmentPct,
          weight: roundTo(entry.weight, 3),
          eligibleCount: entry.eligible,
        })),
        excludedClos: input.clos
          .filter((clo) => {
            const result = cloResults.find((entry) => entry.cloId === clo.id);
            return (
              clo.ploMappings.some((mapping) => mapping.ploId === plo.id) &&
              (!result || result.status === 'INSUFFICIENT_DATA')
            );
          })
          .map((clo) => clo.id),
      },
    };
  });

  return { cloResults, ploResults, studentScores };
}

export function worstStatus(statuses: AttainmentStatusResult[]): AttainmentStatusResult {
  if (statuses.length === 0) return 'INSUFFICIENT_DATA';
  return statuses.reduce((worst, status) =>
    STATUS_ORDER[status] > STATUS_ORDER[worst] ? status : worst
  );
}
