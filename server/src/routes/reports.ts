import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/async-handler.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { forbidden, notFound } from '../lib/errors.js';
import { sendData } from '../lib/http.js';
import { getStudentProfileId } from '../lib/authorization.js';
import { resolvePolicy } from '../services/attainment/policy.js';
import { decideStatus, roundTo } from '../services/attainment/engine.js';
import { audit } from '../lib/audit.js';
import type { Prisma } from '@prisma/client';

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

/* ------------------------- PLO drill-down ------------------------------ */
// Deep inspection of a single PLO across every offering the viewer is
// authorized to see. Each figure is the persisted roll-up from a stored run
// (never recomputed from raw marks on read), and every result carries the run,
// policy version and computation timestamp that produced it.
router.get(
  '/reports/plos/:id',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const plo = await prisma.plo.findUnique({
      where: { id: String(req.params.id) },
      include: { program: { select: { id: true, code: true, name: true } } },
    });
    if (!plo) throw notFound('PLO');

    // Tutors and students may only drill down into PLOs of programmes they
    // have outcomes, courses or enrolments in - identical scoping to the
    // top-level reports endpoint. The same scope is applied to every
    // contribution and mapped CLO below; a programme-level match alone must
    // never expose another tutor's offering evidence.
    let studentProfileId: string | null = null;
    if (req.user!.role !== 'ADMIN') {
      let accessible: string[];
      if (req.user!.role === 'TUTOR') {
        const courseIds = (await prisma.courseOffering.findMany({
          where: { tutorId: req.user!.id },
          select: { courseId: true },
          distinct: ['courseId'],
      }))
          .map((row) => row.courseId);
        const courses = await prisma.course.findMany({ where: { id: { in: courseIds } }, select: { programId: true } });
        accessible = [...new Set(courses.map((course) => course.programId))];
      } else {
        studentProfileId = await getStudentProfileId(req.user!.id);
        const profile = await prisma.studentProfile.findUnique({ where: { id: studentProfileId } });
        accessible = profile?.programId ? [profile.programId] : [];
      }
      if (!accessible.includes(plo.programId)) {
        throw forbidden('You do not have access to this programme outcome');
      }
    }

    const offeringScope: Prisma.CourseOfferingWhereInput | undefined =
      req.user!.role === 'TUTOR'
        ? { tutorId: req.user!.id }
        : req.user!.role === 'STUDENT'
          ? { enrollments: { some: { studentId: studentProfileId!, status: { in: ['ENROLLED', 'COMPLETED'] } } } }
          : undefined;
    const cloScope: Prisma.CloWhereInput | undefined =
      req.user!.role === 'TUTOR'
        ? { course: { offerings: { some: { tutorId: req.user!.id } } } }
        : req.user!.role === 'STUDENT'
          ? {
              course: {
                offerings: {
                  some: {
                    enrollments: { some: { studentId: studentProfileId!, status: { in: ['ENROLLED', 'COMPLETED'] } } },
                  },
                },
              },
            }
          : undefined;

    const contributions = await prisma.ploAttainment.findMany({
      where: {
        ploId: plo.id,
        ...(offeringScope ? { run: { offering: offeringScope } } : {}),
      } satisfies Prisma.PloAttainmentWhereInput,
      include: {
        run: {
          include: {
            offering: {
              include: {
                course: { select: { id: true, code: true, title: true, program: { select: { id: true, code: true } } } },
                semester: { select: { name: true, startDate: true, endDate: true } },
                tutor: { select: { id: true, name: true } },
              },
            },
            policy: { select: { id: true, name: true, version: true } },
            computedBy: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { run: { computedAt: 'desc' } },
    });

    const byOffering = new Map<string, (typeof contributions)[number]>();
    for (const contribution of contributions) {
      // Results are ordered newest-first; retaining the first row gives the
      // latest persisted run per offering without mixing calculation periods.
      if (!byOffering.has(contribution.run.offeringId)) byOffering.set(contribution.run.offeringId, contribution);
    }

    const mappedClos = await prisma.cloPloMapping.findMany({
      where: { ploId: plo.id, ...(cloScope ? { clo: cloScope } : {}) } satisfies Prisma.CloPloMappingWhereInput,
      include: {
        clo: {
          select: {
            id: true,
            code: true,
            description: true,
            approvalStatus: true,
            archivedAt: true,
            course: { select: { id: true, code: true, title: true } },
          },
        },
      },
      orderBy: { clo: { code: 'asc' } },
    });

    return sendData(res, {
      plo: {
        ...plo,
        targetPct: Number(plo.targetAttainment),
      },
      configuredTarget: {
        attainmentPct: Number(plo.targetAttainment),
        accreditationRef: plo.accreditationRef,
      },
      // Latest contribution per offering, so the view reflects the most recent
      // persisted roll-up without mixing runs together.
      offerings: [...byOffering.values()].map((contribution) => ({
        offering: {
          id: contribution.run.offeringId,
          course: contribution.run.offering.course,
          semester: contribution.run.offering.semester,
          sectionName: contribution.run.offering.sectionName,
          tutor: contribution.run.offering.tutor,
        },
        run: {
          id: contribution.run.id,
          computedAt: contribution.run.computedAt,
          isFrozen: contribution.run.isFrozen,
          reportingPeriod: contribution.run.reportingPeriod,
          policyVersion: contribution.run.policy.version,
          policyName: contribution.run.policy.name,
          computedBy: contribution.run.computedBy?.name ?? null,
        },
        result: {
          attainmentPct: Number(contribution.attainmentPct),
          targetPct: Number(contribution.targetPct),
          status: contribution.status,
          contributingClos: contribution.contributingClos,
          weightedCohort: Number(contribution.weightedCohort),
          evidence: contribution.evidenceJson,
        },
      })),
      mappedClos: mappedClos.map((mapping) => ({
        mappingId: mapping.id,
        weight: mapping.weight,
        clo: mapping.clo,
      })),
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

/* ------------------------------- PDF export ------------------------------ */
// Printable, standards-compliant (minimal PDF 1.4) export of the same scoped
// report the JSON/CSV endpoints serve. The payload is generated entirely from
// persisted attainment runs, so the download is byte-identical in scope to the
// on-screen report and records an EXPORT audit entry. HTML (print-to-PDF in
// the browser) is intentionally avoided here: the artifact must be valid even
// without a renderer.
function escapePdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildReportPdf(report: ReturnType<typeof buildReport>, filters: Filters, generatedAt: string): Buffer {
  const lines: string[] = [];
  lines.push('OBE Attainment Report');
  lines.push(`Generated ${generatedAt}  |  Viewer scope: program=${filters.programId ?? 'all'} semester=${filters.semesterId ?? 'all'} offering=${filters.offeringId ?? 'all'}`);
  lines.push('');

  const summary = report.summary;
  lines.push(`Offerings reported: ${report.runs.length}   CLO results: ${summary.clo.total} (met ${summary.clo.met}, at-risk ${summary.clo.atRisk}, not-met ${summary.clo.notMet}, insufficient ${summary.clo.insufficientData})`);
  lines.push(`Policy: ${summary.policy ? `${summary.policy.name} v${summary.policy.version}` : 'no active policy'}`);
  lines.push('');
  lines.push('--- Run provenance ---');
  for (const run of report.runs) {
    lines.push(
      `${run.course.code} - ${run.course.title} | ${run.semester.name} | tutor ${run.tutor.name} | run ${run.id.slice(0, 8)} | computed ${run.computedAt.toISOString()} | policy ${run.policyVersion} | ${run.isFrozen ? 'FROZEN' : 'draft'} | period ${run.reportingPeriod ?? '-'}`
    );
  }
  lines.push('');
  lines.push('--- CLO attainment by offering ---');
  for (const row of report.cloRows) {
    lines.push(
      `${row.course.code} ${row.clo.code}  target ${row.targetPct}%  attained ${row.attainmentPct}%  status ${row.status}  cohort ${row.attainedCount}/${row.eligibleCount} (mean ${row.meanScore})  missing ${row.missingEvidenceCount}  policy ${row.policyVersion}`
    );
  }
  lines.push('');
  lines.push('--- Programme PLO roll-up ---');
  for (const row of report.ploRows) {
    lines.push(
      `${row.plo.code}  target ${row.targetPct}%  attained ${row.attainmentPct}%  status ${row.status}  contributing CLOs ${row.contributingClos}  weighted cohort ${row.weightedCohort}`
    );
  }
  lines.push('');
  lines.push(report.note);

  // Keep the export valid for larger reports as well as the small seeded
  // report. A single-page stream would push later rows below the media box.
  const pageLines = 44;
  const pages = [] as string[][];
  for (let index = 0; index < lines.length; index += pageLines) pages.push(lines.slice(index, index + pageLines));
  const pageObjectIds = pages.map((_page, index) => 3 + index);
  const fontObjectId = 3 + pages.length;
  const contentObjectIds = pages.map((_page, index) => fontObjectId + 1 + index);
  const pageObjects = pages.map(
    (_page, index) =>
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 ${fontObjectId} 0 R>>>>/Contents ${contentObjectIds[index]} 0 R>>`
  );
  const contentObjects = pages.map((page) => {
    const content = page
      .map((text, index) => {
        const y = 760 - index * 16;
        return `BT /F1 10 Tf 40 ${y} Td (${escapePdfText(text)}) Tj ET`;
      })
      .join('\n');
    return `<</Length ${Buffer.byteLength(content, 'utf8')}>>\nstream\n${content}\nendstream`;
  });
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    `<</Type/Pages/Kids[${pageObjectIds.map((id) => `${id} 0 R`).join('')}]/Count ${pages.length}>>`,
    ...pageObjects,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    ...contentObjects,
  ];

  const chunks: string[] = ['%PDF-1.4\n'];
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(chunks.join('')));
    chunks.push(`${index + 1} 0 obj\n${body}\nendobj\n`);
  });
  const xrefOffset = Buffer.byteLength(chunks.join(''));
  chunks.push(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
      .map((offset) => offset.toString().padStart(10, '0') + ' 00000 n \n')
      .join('')}`
  );
  chunks.push(`trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF`);
  return Buffer.from(chunks.join(''), 'utf8');
}

router.get(
  '/reports/attainment.pdf',
  validate(filtersSchema, 'query'),
  asyncHandler(async (req, res) => {
    const filters = req.query as unknown as Filters;
    const { latest } = await loadRuns(req.user!, filters);
    const report = buildReport(latest, 'PDF export of persisted CLO attainment.');

    const generatedAt = new Date().toISOString();
    const pdf = buildReportPdf(report, filters, generatedAt);

    await audit(req, {
      action: 'EXPORT',
      entityType: 'AttainmentReport',
      metadata: { format: 'pdf', rows: report.cloRows.length, filters },
    });

    const filename = `obe-attainment-report-${generatedAt.slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(Buffer.byteLength(pdf)));
    return res.status(200).send(pdf);
  })
);

export default router;
