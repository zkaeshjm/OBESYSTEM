import { z } from 'zod';

/**
 * Configurable institutional attainment policy.
 *
 * Defaults ship with the system and are explicitly documented as a policy,
 * not as a universal OBE formula:
 *  - a student masters a CLO by reaching the CLO's own mastery threshold;
 *  - a CLO is attained at cohort level when the share of eligible students
 *    meeting that threshold reaches the cohort target;
 *  - missing evidence is excluded from the eligible cohort by default;
 *  - excused evidence is always excluded;
 *  - PLO attainment is the weighted mean of contributing CLO attainment,
 *    weighted by mapping strength and eligible cohort size.
 */
export const attainmentPolicySchema = z.object({
  cloMasteryThreshold: z.number().min(0).max(100).default(50),
  cohortAttainmentTarget: z.number().min(0).max(100).default(65),
  minCohortSize: z.number().int().min(1).max(1000).default(5),
  atRiskBand: z.number().min(0).max(100).default(5),
  rounding: z.number().int().min(0).max(4).default(1),
  missingEvidence: z.enum(['exclude', 'zero']).default('exclude'),
  includeUnapprovedClos: z.boolean().default(false),
  ploAggregation: z.literal('weighted').default('weighted'),
  ploWeighting: z.enum(['mapping_weight', 'mapping_weight_and_cohort']).default('mapping_weight_and_cohort'),
});

export type AttainmentPolicy = z.infer<typeof attainmentPolicySchema>;

export const DEFAULT_POLICY: AttainmentPolicy = attainmentPolicySchema.parse({});

export const ENGINE_VERSION = 'attain-v1';

export function resolvePolicy(value: unknown): AttainmentPolicy {
  return attainmentPolicySchema.parse(value ?? {});
}
