/**
 * Assessment blueprint policy, ported from the reviewed prototype
 * (src/data/store.js, v3). Category shares are institutional policy, not a
 * universal OBE rule. Item-level CLO weights remain independently configurable.
 */
export const CATEGORY_WEIGHTS = {
  Assignment: 15,
  Quiz: 15,
  'Mid Exam': 25,
  Project: 15,
  'Final Exam': 30,
} as const;

export type AssessmentCategory = keyof typeof CATEGORY_WEIGHTS;

export const BLUEPRINT_MIN: Partial<Record<AssessmentCategory, number>> = {
  Assignment: 4,
  Quiz: 4,
};

export const BLUEPRINT_FIXED: AssessmentCategory[] = ['Mid Exam', 'Final Exam'];
export const BLUEPRINT_SINGLETONS: AssessmentCategory[] = ['Mid Exam', 'Final Exam', 'Project'];

export const CATEGORY_MAX_MARKS: Record<AssessmentCategory, number> = {
  Assignment: 20,
  Quiz: 10,
  'Mid Exam': 30,
  Project: 50,
  'Final Exam': 50,
};

export const EXAM_PREFIX: Record<AssessmentCategory, string> = {
  Assignment: 'A',
  Quiz: 'Q',
  'Mid Exam': 'M',
  Project: 'P',
  'Final Exam': 'F',
};

export const round1 = (n: number) => Math.round(n * 10) / 10;

/** Project's 15% is redistributed evenly when the course has no project. */
export function computeCategoryShares(hasProject: boolean): Record<string, number> {
  const shares: Record<string, number> = { ...CATEGORY_WEIGHTS };
  if (!hasProject) {
    const projectShare = shares.Project;
    delete shares.Project;
    const spread: AssessmentCategory[] = ['Assignment', 'Quiz', 'Mid Exam', 'Final Exam'];
    const base = projectShare / spread.length;
    for (const key of spread) shares[key] += base;
  }
  return shares;
}

export interface BlueprintComponentInput {
  id: string;
  examType: AssessmentCategory;
}

/**
 * Derives per-component weights so each category sums to its share and the
 * blueprint totals exactly 100%. The last component absorbs rounding.
 */
export function deriveWeights(
  components: BlueprintComponentInput[],
  hasProject = components.some((component) => component.examType === 'Project')
): Array<BlueprintComponentInput & { weightPct: number }> {
  const shares = computeCategoryShares(hasProject);
  const counts = new Map<AssessmentCategory, number>();
  for (const component of components) {
    counts.set(component.examType, (counts.get(component.examType) ?? 0) + 1);
  }
  const seen = new Map<AssessmentCategory, number>();
  return components.map((component) => {
    const index = seen.get(component.examType) ?? 0;
    seen.set(component.examType, index + 1);
    const share = shares[component.examType] ?? 0;
    const count = counts.get(component.examType) ?? 1;
    const per = round1(share / count);
    const weightPct = index === count - 1 ? round1(share - per * (count - 1)) : per;
    return { ...component, weightPct };
  });
}
