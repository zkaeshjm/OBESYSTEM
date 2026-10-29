import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/async-handler.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { sendData } from '../lib/http.js';
import { getStudentProfileId } from '../lib/authorization.js';
import { resolvePolicy } from '../services/attainment/policy.js';
import { decideStatus, roundTo } from '../services/attainment/engine.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(authenticate);

const filtersSchema = z.object({
  programId: z.string().uuid().optional(),
  semesterId: z.string().uuid().optional(),
  offeringId: z.string().uuid().optional(),
});

type Filters = z.infer<typeof filtersSchema>;

async function loadRuns(user: { id: string; role: string }, filters: Filters) {
  const offeringWhere: Record<string, unknown> = {
    ...(filters.programId ? { course: { programId: filters.programId } } : {}),
    ...(filters.semesterId ? { semesterId: filters.semesterId } : {}),
    ...(filters.offeringId ? { id: filters.offeringId } : {}),
  };
  if (user.role === 'TUTOR') offeringWhere.tutorId = user.id;
  if (user.role === 'STUDENT') {
    const profileId = await getStudentProfileId(user.id);
    offeringWhere.enrollments = { some: { studentId: profileId, status: { in: ['ENROLLED', 'COMPLETED'] } } };
  }

  const runs = await prisma.attainmentRun.findMany({
    where: { offering: offeringWhere },
    include: {
      offering: {
        include: {
          course: { include: { program: { select: { id: true, code: true, name: true } } } },
          semester: { select: { id: true, name: true } },
          tutor: { select: { id: true, name: true } },
        },
      },
      policy: { select: { id: true, name: true, version: true } },
      computedBy: { select: { id: true, name: true } },
      cloResults: {
        include: {
          clo: {
            select: {
              id: true,
              code: true,
              description: true,
              ploMappings: {
                select: {
                  ploId: true,
                  weight: true,
                  plo: { select: { id: true, code: true, description: true, targetAttainment: true } },
                },
              },
            },
          },
        },
      },
      ploResults: {
        include: { plo: { select: { id: true, code: true, description: true, targetAttainment: true } } },
      },
    },
    orderBy: { computedAt: 'desc' },
    take: 500,
  });

  const latestByOffering = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    if (!latestByOffering.has(run.offeringId)) latestByOffering.set(run.offeringId, run);
  }
  return { runs, latest: [...latestByOffering.values()] };
}

function summarize(statuses: string[]) {
  return {
    total: statuses.length,
    met: statuses.filter((status) => status === 'MET').length,
    atRisk: statuses.filter((status) => status === 'AT_RISK').length,
    notMet: statuses.filter((status) => status === 'NOT_MET').length,
    insufficientData: statuses.filter((status) => status === 'INSUFFICIENT_DATA').length,
  };
}

function buildReport(latest: Awaited<ReturnType<typeof loadRuns>>['latest'], note: string) {
  const cloRows = latest.flatMap((run) =>
    run.cloResults.map((result) => ({
      runId: run.id,
      offeringId: run.offeringId,
      computedAt: run.computedAt,
      isFrozen: run.isFrozen,
      policyVersion: run.policyVersion,
      engineVersion: run.engineVersion,
      course: run.offering.course,
      semester: run.offering.semester,
      tutor: run.offering.tutor,
      clo: { id: result.clo.id, code: result.clo.code, description: result.clo.description },
      cohortSize: result.cohortSize,
      eligibleCount: result.eligibleCount,
      attainedCount: result.attainedCount,
      meanScore: Number(result.meanScore),
      attainmentPct: Number(result.attainmentPct),
      targetPct: Number(result.targetPct),
      status: result.status,
      missingEvidenceCount: result.missingEvidenceCount,
      cloMappings: result.clo.ploMappings,
    }))
  );

  // Programme-level PLO roll-up across every selected offering. CLO attainment
  // is weighted by mapping strength and eligible cohort, matching the engine's
  // contract but applied to persisted results so the report is reproducible.
  interface Contribution {
    pct: number;
    weight: number;
    eligible: number;
    runId: string;
    cloId: string;
  }
  const ploMap = new Map<
    string,
    {
      plo: { id: string; code: string; description: string; targetAttainment: unknown };
      contributions: Contribution[];
    }
  >();

  for (const run of latest) {
    const policy = resolvePolicy(run.policySnapshot);
    for (const result of run.cloResults) {
      if (result.eligibleCount === 0 || result.status === 'INSUFFICIENT_DATA') continue;
      for (const mapping of result.clo.ploMappings) {
        const existing = ploMap.get(mapping.ploId) ?? {
          plo: {
            id: mapping.plo.id,
            code: mapping.plo.code,
            description: mapping.plo.description,
            targetAttainment: mapping.plo.targetAttainment,
          },
          contributions: [],
        };
        existing.contributions.push({
          pct: Number(result.attainmentPct),
          weight: mapping.weight * result.eligibleCount,
          eligible: result.eligibleCount,
          runId: run.id,
          cloId: result.clo.id,
        });
        ploMap.set(mapping.ploId, existing);
      }
      void policy;
    }
  }

  const activePolicy = latest.find((run) => run.policy)?.policy;
  const band = (() => {
    for (const run of latest) {
      try {
        return resolvePolicy(run.policySnapshot).atRiskBand;
      } catch {
        // try next run
      }
    }
    return 5;
  })();

  const ploRows = [...ploMap.values()]
    .map((entry) => {
      const totalWeight = entry.contributions.reduce((sum, contribution) => sum + contribution.weight, 0);
      const pct =
        totalWeight === 0
          ? 0
          : entry.contributions.reduce((sum, contribution) => sum + contribution.pct * contribution.weight, 0) /
            totalWeight;
      const target = Number(entry.plo.targetAttainment);
      return {
        plo: { id: entry.plo.id, code: entry.plo.code, description: entry.plo.description, targetAttainment: target },
        attainmentPct: roundTo(pct, 1),
        targetPct: target,
        status: decideStatus(pct, target, band, entry.contributions.length > 0),
        contributingClos: new Set(entry.contributions.map((contribution) => contribution.cloId)).size,
        weightedCohort: entry.contributions.reduce((sum, contribution) => sum + contribution.eligible, 0),
        runIds: [...new Set(entry.contributions.map((contribution) => contribution.runId))],
      };
    })
    .sort((a, b) => a.plo.code.localeCompare(b.plo.code));

  return {
    note,
    runs: latest.map((run) => ({
      id: run.id,
      offeringId: run.offeringId,
      computedAt: run.computedAt,
      isFrozen: run.isFrozen,
      engineVersion: run.engineVersion,
      policyVersion: run.policyVersion,
      policy: run.policy,
      reportingPeriod: run.reportingPeriod,
      course: run.offering.course,
      semester: run.offering.semester,
      tutor: run.offering.tutor,
      computedBy: run.computedBy,
    })),
    cloRows,
    ploRows,
    summary: {
      clo: summarize(cloRows.map((row) => row.status)),
      plo: summarize(ploRows.map((row) => row.status)),
      policy: activePolicy ?? null,
      aggregationBand: band,
    },
  };
}

router.get(
  '/reports/attainment',
  validate(filtersSchema, 'query'),
  asyncHandler(async (req, res) => {
    const filters = req.query as unknown as Filters;
    const { latest } = await loadRuns(req.user!, filters);
    const report = buildReport(
      latest,
      'Each offering contributes its most recent attainment run. Programme PLO attainment is a weighted roll-up of persisted CLO results; it is not recomputed from raw marks.'
    );
    return sendData(res, {
      filters,
      ...report,
      provenance: {
        source: 'persisted_attainment_runs',
        latestRunPerOffering: true,
        offeringCount: latest.length,
      },
    });
  })
);

router.get(
  '/reports/gaps',
  validate(filtersSchema, 'query'),
  asyncHandler(async (req, res) => {
    const filters = req.query as unknown as Filters;
    const { latest } = await loadRuns(req.user!, filters);
    const report = buildReport(latest, 'Only unmet and at-risk outcomes are listed, ranked by shortfall.');
    const cloGaps = report.cloRows
      .filter((row) => row.status === 'NOT_MET' || row.status === 'AT_RISK')
      .map((row) => ({ ...row, shortfall: roundTo(row.targetPct - row.attainmentPct, 1) }))
      .sort((a, b) => b.shortfall - a.shortfall);
    const ploGaps = report.ploRows
      .filter((row) => row.status === 'NOT_MET' || row.status === 'AT_RISK')
      .map((row) => ({ ...row, shortfall: roundTo(row.targetPct - row.attainmentPct, 1) }))
      .sort((a, b) => b.shortfall - a.shortfall);

    return sendData(res, {
      filters,
      cloGaps,
      ploGaps,
      summary: { cloGaps: cloGaps.length, ploGaps: ploGaps.length },
      provenance: report.runs,
    });
  })
);

const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'number' ? String(value) : String(value);
  // Neutralise spreadsheet formula injection before quoting.
  if (CSV_FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

router.get(
  '/reports/attainment.csv',
  validate(filtersSchema, 'query'),
  asyncHandler(async (req, res) => {
    const filters = req.query as unknown as Filters;
    const { latest } = await loadRuns(req.user!, filters);
    const report = buildReport(latest, 'CSV export of persisted CLO attainment.');

    const generatedAt = new Date().toISOString();
    const columns = [
      'course_code',
      'course_title',
      'semester',
      'tutor',
      'clo_code',
      'clo_description',
      'target_pct',
      'attainment_pct',
      'status',
      'eligible_count',
      'attained_count',
      'mean_score',
      'missing_evidence_count',
      'policy_version',
      'is_frozen',
      'computed_at',
      'reporting_period',
      'generated_at',
    ] as const;

    const lines = [columns.join(',')];
    for (const row of report.cloRows) {
      const values: Record<(typeof columns)[number], unknown> = {
        course_code: row.course.code,
        course_title: row.course.title,
        semester: row.semester.name,
        tutor: row.tutor.name,
        clo_code: row.clo.code,
        clo_description: row.clo.description,
        target_pct: row.targetPct,
        attainment_pct: row.attainmentPct,
        status: row.status,
        eligible_count: row.eligibleCount,
        attained_count: row.attainedCount,
        mean_score: row.meanScore,
        missing_evidence_count: row.missingEvidenceCount,
        policy_version: row.policyVersion,
        is_frozen: row.isFrozen,
        computed_at: new Date(row.computedAt).toISOString(),
        reporting_period:
          report.runs.find((run) => run.id === row.runId)?.reportingPeriod ?? '',
        generated_at: generatedAt,
      };
      lines.push(columns.map((column) => csvCell(values[column])).join(','));
    }

    const filename = `obe-attainment-${generatedAt.slice(0, 10)}.csv`;
    await audit(req, {
      action: 'EXPORT',
      entityType: 'AttainmentReport',
      metadata: { format: 'csv', rows: report.cloRows.length, filters },
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(`${lines.join('\r\n')}\r\n`);
  })
);

export default router;
