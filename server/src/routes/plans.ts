import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/async-handler.js';
import { badRequest, notFound } from '../lib/errors.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getManagedOffering } from '../lib/authorization.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { sendData } from '../lib/http.js';

const router = Router();
const staffOnly = [authenticate, requireRole('ADMIN', 'TUTOR')];

const planSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(5000),
  gapDescription: z.string().trim().max(5000).optional().nullable(),
  followUp: z.string().trim().max(5000).optional().nullable(),
  cloId: z.string().uuid().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
});

router.get(
  '/offerings/:id/action-plans',
  ...staffOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    await getManagedOffering(req.user!, String(req.params.id));
    const rows = await prisma.improvementActionPlan.findMany({
      where: { offeringId: String(req.params.id) },
      include: {
        clo: { select: { id: true, code: true, description: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    return sendData(res, rows);
  })
);

router.post(
  '/offerings/:id/action-plans',
  ...staffOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(planSchema),
  asyncHandler(async (req, res) => {
    const offering = await getManagedOffering(req.user!, String(req.params.id));
    if (req.body.cloId) {
      const clo = await prisma.clo.findUnique({ where: { id: req.body.cloId } });
      if (!clo || clo.courseId !== offering.courseId) {
        throw badRequest('The improvement plan CLO must belong to this offering course');
      }
    }
    const row = await prisma.improvementActionPlan.create({
      data: {
        offeringId: offering.id,
        title: req.body.title,
        description: req.body.description,
        gapDescription: req.body.gapDescription ?? null,
        followUp: req.body.followUp ?? null,
        cloId: req.body.cloId ?? null,
        dueDate: req.body.dueDate ?? null,
        createdById: req.user!.id,
      },
      include: { clo: { select: { id: true, code: true } } },
    });
    await audit(req, {
      action: 'INSERT',
      entityType: 'ImprovementActionPlan',
      entityId: row.id,
      metadata: { offeringId: offering.id, cloId: row.cloId },
    });
    if (req.user!.role === 'TUTOR') {
      const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
      await notify({
        userIds: admins.map((admin) => admin.id),
        type: 'IMPROVEMENT_PLAN',
        title: 'Improvement plan created',
        body: `${req.user!.name} created an improvement plan for ${offering.sectionName}.`,
        link: `/offerings/${offering.id}`,
      });
    }
    return sendData(res, row, { status: 201 });
  })
);

router.patch(
  '/action-plans/:id',
  ...staffOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(
    z.object({
      title: z.string().trim().min(3).max(200).optional(),
      description: z.string().trim().min(10).max(5000).optional(),
      gapDescription: z.string().trim().max(5000).optional().nullable(),
      followUp: z.string().trim().max(5000).optional().nullable(),
      status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
      evaluation: z.string().trim().max(5000).optional().nullable(),
      dueDate: z.coerce.date().optional().nullable(),
    })
  ),
  asyncHandler(async (req, res) => {
    const existing = await prisma.improvementActionPlan.findUnique({
      where: { id: String(req.params.id) },
      include: { offering: { include: { course: true } } },
    });
    if (!existing) throw notFound('Improvement action plan');
    await getManagedOffering(req.user!, existing.offeringId);

    const evaluation = req.body.evaluation ?? existing.evaluation;
    if (req.body.status === 'COMPLETED' && !evaluation) {
      throw badRequest('Record an evaluation before completing an improvement plan');
    }

    const row = await prisma.improvementActionPlan.update({
      where: { id: existing.id },
      data: {
        ...req.body,
        ...(req.body.status === 'COMPLETED' ? { evaluatedAt: new Date() } : {}),
      },
      include: { clo: { select: { id: true, code: true } } },
    });
    await audit(req, {
      action: 'UPDATE',
      entityType: 'ImprovementActionPlan',
      entityId: row.id,
      metadata: { fields: Object.keys(req.body), status: row.status },
    });
    if (row.status === 'COMPLETED') {
      const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
      await notify({
        userIds: [...new Set([...admins.map((admin) => admin.id), existing.offering.tutorId])],
        type: 'IMPROVEMENT_PLAN',
        title: 'Improvement plan completed',
        body: `${row.title} (${existing.offering.course.code}) has an evaluation on record.`,
        link: `/offerings/${existing.offeringId}`,
      });
    }
    return sendData(res, row);
  })
);

export default router;
