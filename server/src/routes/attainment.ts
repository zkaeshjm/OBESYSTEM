import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/async-handler.js';
import { badRequest, notFound } from '../lib/errors.js';
import { validate } from '../middleware/validate.js';
import { adminOnly, authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { sendData } from '../lib/http.js';
import { getManagedOffering, getOfferingForViewer, getStudentProfileId } from '../lib/authorization.js';
import { attainmentPolicySchema, resolvePolicy } from '../services/attainment/policy.js';
import {
  buildOfferingInput,
  computeOfferingAttainment,
  freezeRun,
  resolveActivePolicy,
} from '../services/attainment-service.js';
import { computeAttainment } from '../services/attainment/engine.js';

const router = Router();
router.use(authenticate);

const policyBodySchema = z.object({
  name: z.string().trim().min(3).max(160),
  version: z.string().trim().min(1).max(40),
  description: z.string().trim().max(2000).optional().nullable(),
  config: attainmentPolicySchema,
  isActive: z.boolean().optional(),
});

router.get(
  '/attainment-policies',
  requireRole('ADMIN', 'TUTOR'),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.attainmentPolicy.findMany({
      include: { createdBy: { select: { id: true, name: true } }, _count: { select: { runs: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return sendData(res, rows);
  })
);

router.post(
  '/attainment-policies',
  adminOnly,
  validate(policyBodySchema),
  asyncHandler(async (req, res) => {
    const config = resolvePolicy(req.body.config);
    const row = await prisma.$transaction(async (tx) => {
      if (req.body.isActive) {
        await tx.attainmentPolicy.updateMany({ where: { isActive: true }, data: { isActive: false } });
      }
      return tx.attainmentPolicy.create({
        data: {
          name: req.body.name,
          version: req.body.version,
          description: req.body.description ?? null,
          config: config as never,
          isActive: Boolean(req.body.isActive),
          createdById: req.user!.id,
        },
      });
    });
    await audit(req, { action: 'INSERT', entityType: 'AttainmentPolicy', entityId: row.id, metadata: { version: row.version, config } });
    return sendData(res, row, { status: 201 });
  })
);

router.post(
  '/attainment-policies/:id/activate',
  adminOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.attainmentPolicy.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) throw notFound('Attainment policy');
    const row = await prisma.$transaction(async (tx) => {
      await tx.attainmentPolicy.updateMany({ where: { isActive: true }, data: { isActive: false } });
      return tx.attainmentPolicy.update({ where: { id: existing.id }, data: { isActive: true } });
    });
    await audit(req, { action: 'UPDATE', entityType: 'AttainmentPolicy', entityId: row.id, metadata: { active: true } });
    return sendData(res, row);
  })
);

const runBodySchema = z.object({
  policyId: z.string().uuid().optional(),
  reportingPeriod: z.string().trim().max(80).optional().nullable(),
});

router.post(
  '/offerings/:id/attainment-runs',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(runBodySchema),
  asyncHandler(async (req, res) => {
    const offering = await getManagedOffering(req.user!, String(req.params.id));
    const policy = await resolveActivePolicy(req.body.policyId);
    const result = await computeOfferingAttainment(offering.id, {
      policy: policy.parsedConfig,
      persist: true,
      computedById: req.user!.id,
      policyId: policy.id,
      reportingPeriod: req.body.reportingPeriod,
    });
    if (!result.run) throw badRequest('Attainment could not be computed');
    await audit(req, {
      action: 'COMPUTE_ATTAINMENT',
      entityType: 'AttainmentRun',
      entityId: result.run.id,
      metadata: {
        offeringId: offering.id,
        policyId: policy.id,
        policyVersion: policy.version,
        engineVersion: result.run.engineVersion,
        cloResults: result.output.cloResults.length,
        ploResults: result.output.ploResults.length,
      },
    });
    return sendData(res, result.run, { status: 201 });
  })
);

router.get(
  '/offerings/:id/attainment-runs',
  asyncHandler(async (req, res) => {
    await getOfferingForViewer(req.user!, String(req.params.id));
    const rows = await prisma.attainmentRun.findMany({
      where: { offeringId: String(req.params.id) },
      include: {
        computedBy: { select: { id: true, name: true } },
        policy: { select: { id: true, name: true, version: true } },
        _count: { select: { cloResults: true, ploResults: true } },
      },
      orderBy: { computedAt: 'desc' },
    });
    return sendData(res, rows);
  })
);

router.get(
  '/offerings/:id/attainment/latest',
  asyncHandler(async (req, res) => {
    await getOfferingForViewer(req.user!, String(req.params.id));
    const run = await prisma.attainmentRun.findFirst({
      where: { offeringId: String(req.params.id) },
      include: {
        policy: { select: { id: true, name: true, version: true } },
        computedBy: { select: { id: true, name: true } },
        cloResults: {
          include: { clo: { select: { id: true, code: true, description: true, courseId: true } } },
          orderBy: { clo: { code: 'asc' } },
        },
        ploResults: {
          include: { plo: { select: { id: true, code: true, description: true, targetAttainment: true } } },
          orderBy: { plo: { code: 'asc' } },
        },
      },
      orderBy: { computedAt: 'desc' },
    });
    if (!run) return sendData(res, null);
    return sendData(res, sanitizeRun(run, req.user!.role === 'STUDENT'));
  })
);

router.get(
  '/attainment-runs/:id',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const run = await prisma.attainmentRun.findUnique({
      where: { id: String(req.params.id) },
      include: {
        offering: { select: { id: true, courseId: true, tutorId: true } },
        policy: { select: { id: true, name: true, version: true } },
        computedBy: { select: { id: true, name: true } },
        cloResults: {
          include: { clo: { select: { id: true, code: true, description: true } } },
          orderBy: { clo: { code: 'asc' } },
        },
        ploResults: {
          include: { plo: { select: { id: true, code: true, description: true, targetAttainment: true } } },
          orderBy: { plo: { code: 'asc' } },
        },
      },
    });
    if (!run) throw notFound('Attainment run');
    await getOfferingForViewer(req.user!, run.offeringId);
    return sendData(res, sanitizeRun(run, req.user!.role === 'STUDENT'));
  })
);

router.post(
  '/attainment-runs/:id/freeze',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const run = await prisma.attainmentRun.findUnique({ where: { id: String(req.params.id) } });
    if (!run) throw notFound('Attainment run');
    await getManagedOffering(req.user!, run.offeringId);
    const frozen = await freezeRun(run.id, req.user!.id);
    await audit(req, { action: 'FINALIZE', entityType: 'AttainmentRun', entityId: frozen.id, metadata: { offeringId: run.offeringId } });
    return sendData(res, frozen);
  })
);

router.get(
  '/students/me/progress',
  requireRole('STUDENT'),
  asyncHandler(async (req, res) => {
    const profileId = await getStudentProfileId(req.user!.id);
    const profile = await prisma.studentProfile.findUnique({
      where: { id: profileId },
      include: {
        enrollments: {
          where: { status: { in: ['ENROLLED', 'COMPLETED'] } },
          include: {
            offering: {
              include: {
                course: { select: { id: true, code: true, title: true } },
                semester: { select: { id: true, name: true } },
                attainmentRuns: { orderBy: { computedAt: 'desc' }, take: 1 },
              },
            },
          },
        },
      },
    });
    if (!profile) throw notFound('Student profile');

    const rows = [];
    for (const enrollment of profile.enrollments) {
      const latestRun = enrollment.offering.attainmentRuns[0];
      if (!latestRun) {
        rows.push({
          offering: enrollment.offering,
          run: null,
          cloScores: [],
          message: 'Attainment has not been calculated for this course yet.',
        });
        continue;
      }
      const policy = resolvePolicy(latestRun.policySnapshot);
      const evidence = await buildOfferingInput(enrollment.offeringId, {
        policy,
        onlyStudentProfileId: profileId,
        includeUnpublishedResults: false,
      });
      let output;
      try {
        output = computeAttainment(evidence.input);
      } catch {
        output = { cloResults: [], ploResults: [], studentScores: [] };
      }
      const cohortRun = await prisma.attainmentRun.findUnique({
        where: { id: latestRun.id },
        include: {
          cloResults: { include: { clo: { select: { code: true, description: true } } } },
          ploResults: { include: { plo: { select: { code: true, description: true } } } },
        },
      });
      rows.push({
        offering: {
          id: enrollment.offering.id,
          course: enrollment.offering.course,
          semester: enrollment.offering.semester,
          tutorId: enrollment.offering.tutorId,
        },
        run: cohortRun
          ? sanitizeRun(cohortRun, true)
          : null,
        cloScores: output.cloResults.map((result) => {
          const own = output.studentScores.find((score) => score.cloId === result.cloId);
          return {
            cloId: result.cloId,
            code: result.code,
            score: own?.score ?? null,
            mastered: own?.mastered ?? null,
            masteryThreshold: result.masteryThreshold,
            cohortAttainmentPct: result.attainmentPct,
            cohortStatus: result.status,
          };
        }),
        message: null,
      });
    }

    return sendData(res, {
      student: {
        id: profile.id,
        rollNo: profile.rollNo,
        programId: profile.programId,
        name: req.user!.name,
      },
      offerings: rows,
    });
  })
);

function sanitizeRun<T extends Record<string, unknown>>(run: T, sanitize: boolean) {
  if (!sanitize) return run;
  const clone = { ...run } as Record<string, unknown>;
  if (Array.isArray(run.cloResults)) {
    clone.cloResults = (run.cloResults as Array<Record<string, unknown>>).map((result) => {
      const { evidenceJson, ...rest } = result;
      void evidenceJson;
      return rest;
    });
  }
  if (Array.isArray(run.ploResults)) {
    clone.ploResults = (run.ploResults as Array<Record<string, unknown>>).map((result) => {
      const { evidenceJson, ...rest } = result;
      void evidenceJson;
      return rest;
    });
  }
  return clone;
}

export default router;
