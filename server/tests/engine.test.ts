import { describe, expect, it } from 'vitest';
import { computeAttainment, EngineInputError, decideStatus, type EngineInput } from '../src/services/attainment/engine.js';
import { DEFAULT_POLICY, type AttainmentPolicy } from '../src/services/attainment/policy.js';
import { deriveWeights, computeCategoryShares } from '../src/services/attainment/blueprint.js';

const policy: AttainmentPolicy = { ...DEFAULT_POLICY, minCohortSize: 5, cohortAttainmentTarget: 65, atRiskBand: 5 };

function studentsWithMarks(marksByStudent: Array<number | null>) {
  return marksByStudent.map((marks, index) => ({
    id: `s${index + 1}`,
    name: `Student ${index + 1}`,
    rollNo: `R-${index + 1}`,
    grades:
      marks === null
        ? []
        : [
            {
              itemId: 'i1',
              marks,
              state: 'GRADED' as const,
            },
          ],
  }));
}

function baseInput(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    policy,
    clos: [{ id: 'c1', code: 'CLO-1', masteryThreshold: 60, ploMappings: [{ ploId: 'p1', weight: 3 }] }],
    plos: [{ id: 'p1', code: 'PLO-1', targetAttainment: 65 }],
    items: [{ id: 'i1', maxMarks: 100, cloMappings: [{ cloId: 'c1', weight: 1 }] }],
    students: studentsWithMarks([90, 80, 70, 60, 50]),
    ...overrides,
  };
}

describe('CLO attainment', () => {
  it('computes the share of eligible students meeting the mastery threshold', () => {
    const output = computeAttainment(baseInput());
    const result = output.cloResults[0];
    expect(result.cohortSize).toBe(5);
    expect(result.eligibleCount).toBe(5);
    expect(result.attainedCount).toBe(4);
    expect(result.attainmentPct).toBe(80);
    expect(result.meanScore).toBe(70);
    expect(result.status).toBe('MET');
  });

  it('counts a student exactly on the threshold as attained', () => {
    const output = computeAttainment(baseInput({ students: studentsWithMarks([60, 60, 60, 60, 60]) }));
    expect(output.cloResults[0].attainedCount).toBe(5);
    expect(output.cloResults[0].attainmentPct).toBe(100);
  });

  it('reports at_risk inside the configured band and not_met below it', () => {
    const atRisk = computeAttainment(baseInput({ students: studentsWithMarks([90, 80, 70, 50, 40]) }));
    expect(atRisk.cloResults[0].attainmentPct).toBe(60);
    expect(atRisk.cloResults[0].status).toBe('AT_RISK');

    const notMet = computeAttainment(baseInput({ students: studentsWithMarks([90, 80, 50, 40, 30]) }));
    expect(notMet.cloResults[0].attainmentPct).toBe(40);
    expect(notMet.cloResults[0].status).toBe('NOT_MET');
  });

  it('flags a cohort below the configured minimum as insufficient data', () => {
    const output = computeAttainment(baseInput({ students: studentsWithMarks([90, 80, 70, 60]) }));
    expect(output.cloResults[0].eligibleCount).toBe(4);
    expect(output.cloResults[0].status).toBe('INSUFFICIENT_DATA');
  });

  it('excludes missing evidence by default and records the exclusion count', () => {
    const output = computeAttainment(
      baseInput({ policy: { ...policy, minCohortSize: 3 }, students: studentsWithMarks([90, 80, 70, null, null]) })
    );
    const result = output.cloResults[0];
    expect(result.eligibleCount).toBe(3);
    expect(result.attainedCount).toBe(3);
    expect(result.attainmentPct).toBe(100);
    expect(result.missingEvidenceCount).toBe(2);
    expect(result.status).toBe('MET');
  });

  it('scores missing evidence as zero when the policy requires it', () => {
    const output = computeAttainment(
      baseInput({
        policy: { ...policy, missingEvidence: 'zero' },
        students: studentsWithMarks([90, 80, 70, null, null]),
      })
    );
    const result = output.cloResults[0];
    expect(result.eligibleCount).toBe(5);
    expect(result.attainedCount).toBe(3);
    expect(result.attainmentPct).toBe(60);
    expect(result.status).toBe('AT_RISK');
  });

  it('always excludes excused evidence', () => {
    const students = studentsWithMarks([90, 80, 70, 60]).map((student) => student);
    students.push({
      id: 's5',
      name: 'Excused',
      rollNo: 'R-5',
      grades: [{ itemId: 'i1', marks: 0, state: 'EXCUSED' as const }],
    });
    const output = computeAttainment(baseInput({ policy: { ...policy, minCohortSize: 4 }, students }));
    expect(output.cloResults[0].eligibleCount).toBe(4);
    expect(output.cloResults[0].attainmentPct).toBe(100);
    expect(output.cloResults[0].missingEvidenceCount).toBe(1);
  });

  it('renormalises item weights within the CLO', () => {
    const output = computeAttainment(
      baseInput({
        items: [
          { id: 'i1', maxMarks: 20, cloMappings: [{ cloId: 'c1', weight: 1 }] },
          { id: 'i2', maxMarks: 40, cloMappings: [{ cloId: 'c1', weight: 3 }] },
        ],
        students: [1, 2, 3, 4, 5].map((index) => ({
          id: `s${index}`,
          name: `S${index}`,
          rollNo: `R${index}`,
          grades: [
            { itemId: 'i1', marks: index <= 2 ? 20 : 10, state: 'GRADED' as const },
            { itemId: 'i2', marks: index <= 2 ? 40 : 20, state: 'GRADED' as const },
          ],
        })),
      })
    );
    expect(output.cloResults[0].meanScore).toBe(70);
    expect(output.cloResults[0].attainmentPct).toBe(40);
  });
});

describe('PLO attainment', () => {
  it('weights contributing CLOs by mapping strength and eligible cohort', () => {
    const output = computeAttainment(
      baseInput({
        clos: [
          { id: 'c1', code: 'CLO-1', masteryThreshold: 60, ploMappings: [{ ploId: 'p1', weight: 3 }] },
          { id: 'c2', code: 'CLO-2', masteryThreshold: 60, ploMappings: [{ ploId: 'p1', weight: 1 }] },
        ],
        items: [
          { id: 'i1', maxMarks: 100, cloMappings: [{ cloId: 'c1', weight: 1 }] },
          { id: 'i2', maxMarks: 100, cloMappings: [{ cloId: 'c2', weight: 1 }] },
        ],
        students: [1, 2, 3, 4, 5].map((index) => ({
          id: `s${index}`,
          name: `S${index}`,
          rollNo: `R${index}`,
          grades: [
            { itemId: 'i1', marks: index <= 4 ? 90 : 20, state: 'GRADED' as const },
            { itemId: 'i2', marks: index <= 2 ? 90 : 20, state: 'GRADED' as const },
          ],
        })),
      })
    );
    const plo = output.ploResults[0];
    expect(output.cloResults.find((result) => result.cloId === 'c1')?.attainmentPct).toBe(80);
    expect(output.cloResults.find((result) => result.cloId === 'c2')?.attainmentPct).toBe(40);
    expect(plo.attainmentPct).toBe(70);
    expect(plo.status).toBe('MET');
    expect(plo.contributingClos).toBe(2);
  });

  it('reports insufficient data when no CLO contributes', () => {
    const output = computeAttainment(
      baseInput({
        clos: [{ id: 'c1', code: 'CLO-1', masteryThreshold: 60, ploMappings: [] }],
      })
    );
    expect(output.ploResults[0].status).toBe('INSUFFICIENT_DATA');
    expect(output.ploResults[0].contributingClos).toBe(0);
  });

  it('handles an empty student cohort without dividing by zero', () => {
    const output = computeAttainment(baseInput({ students: [] }));
    expect(output.cloResults[0].status).toBe('INSUFFICIENT_DATA');
    expect(output.cloResults[0].attainmentPct).toBe(0);
    expect(output.ploResults[0].status).toBe('INSUFFICIENT_DATA');
  });
});

describe('rounding and invalid input', () => {
  it('rounds to the configured number of decimals', () => {
    const output = computeAttainment(
      baseInput({
        policy: { ...policy, rounding: 2, minCohortSize: 3 },
        students: studentsWithMarks([67, 67, 66]),
      })
    );
    expect(output.cloResults[0].meanScore).toBe(66.67);
  });

  it('throws for marks above the item maximum', () => {
    expect(() => computeAttainment(baseInput({ students: studentsWithMarks([101, 80, 70, 60, 50]) }))).toThrow(EngineInputError);
  });

  it('throws for negative marks, unknown items and duplicate grades', () => {
    expect(() => computeAttainment(baseInput({ students: studentsWithMarks([-1, 80, 70, 60, 50]) }))).toThrow(EngineInputError);
    const unknown = studentsWithMarks([80, 80, 70, 60, 50]);
    unknown[0].grades[0].itemId = 'does-not-exist';
    expect(() => computeAttainment(baseInput({ students: unknown }))).toThrow(EngineInputError);

    const duplicate = studentsWithMarks([80, 80, 70, 60, 50]);
    duplicate[0].grades.push({ itemId: 'i1', marks: 10, state: 'GRADED' });
    expect(() => computeAttainment(baseInput({ students: duplicate }))).toThrow(EngineInputError);
  });

  it('throws for an item with no positive maximum', () => {
    expect(() => computeAttainment(baseInput({ items: [{ id: 'i1', maxMarks: 0, cloMappings: [{ cloId: 'c1', weight: 1 }] }] }))).toThrow(
      EngineInputError
    );
  });

  it('applies the status decision boundaries explicitly', () => {
    expect(decideStatus(65, 65, 5, true)).toBe('MET');
    expect(decideStatus(60, 65, 5, true)).toBe('AT_RISK');
    expect(decideStatus(59.9, 65, 5, true)).toBe('NOT_MET');
    expect(decideStatus(100, 65, 5, false)).toBe('INSUFFICIENT_DATA');
  });
});

describe('assessment blueprint policy', () => {
  it('redistributes the project share when no project exists', () => {
    const shares = computeCategoryShares(false);
    expect(shares.Project).toBeUndefined();
    expect(shares.Assignment).toBe(18.75);
    expect(shares.Quiz).toBe(18.75);
    expect(shares['Mid Exam']).toBe(28.75);
    expect(shares['Final Exam']).toBe(33.75);
  });

  it('derives weights that total exactly 100', () => {
    const components = [
      ...Array.from({ length: 4 }, () => ({ id: crypto.randomUUID(), examType: 'Assignment' as const })),
      ...Array.from({ length: 4 }, () => ({ id: crypto.randomUUID(), examType: 'Quiz' as const })),
      { id: crypto.randomUUID(), examType: 'Mid Exam' as const },
      { id: crypto.randomUUID(), examType: 'Project' as const },
      { id: crypto.randomUUID(), examType: 'Final Exam' as const },
    ];
    const weighted = deriveWeights(components);
    const total = weighted.reduce((sum, component) => sum + component.weightPct, 0);
    expect(Math.round(total * 10) / 10).toBe(100);
  });

  it('derives a 100 total without a project', () => {
    const components = [
      ...Array.from({ length: 4 }, () => ({ id: crypto.randomUUID(), examType: 'Assignment' as const })),
      ...Array.from({ length: 4 }, () => ({ id: crypto.randomUUID(), examType: 'Quiz' as const })),
      { id: crypto.randomUUID(), examType: 'Mid Exam' as const },
      { id: crypto.randomUUID(), examType: 'Final Exam' as const },
    ];
    const total = deriveWeights(components).reduce((sum, component) => sum + component.weightPct, 0);
    expect(Math.round(total * 10) / 10).toBe(100);
  });
});
