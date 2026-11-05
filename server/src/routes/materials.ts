import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/async-handler.js';
import { notFound } from '../lib/errors.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getManagedOffering, getOfferingForViewer } from '../lib/authorization.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { sendData } from '../lib/http.js';

const router = Router();
router.use(authenticate);

const materialSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  url: z
    .string()
    .url()
    .max(2000)
    .refine((value) => /^https?:\/\//i.test(value), 'Only http(s) links are permitted'),
  isPublished: z.boolean().optional(),
});

router.get(
  '/offerings/:id/materials',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    await getOfferingForViewer(req.user!, String(req.params.id));
    const isManager = req.user!.role === 'ADMIN' || req.user!.role === 'TUTOR';
    const rows = await prisma.courseMaterial.findMany({
      where: { offeringId: String(req.params.id), ...(isManager ? {} : { isPublished: true }) },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }],
    });
    return sendData(res, rows);
  })
);

router.post(
  '/offerings/:id/materials',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(materialSchema),
  asyncHandler(async (req, res) => {
    const offering = await getManagedOffering(req.user!, String(req.params.id));
    const row = await prisma.courseMaterial.create({
      data: {
        offeringId: offering.id,
        title: req.body.title,
        description: req.body.description ?? null,
        url: req.body.url,
        isPublished: Boolean(req.body.isPublished),
        createdById: req.user!.id,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    await audit(req, {
      action: 'INSERT',
      entityType: 'CourseMaterial',
      entityId: row.id,
      metadata: { offeringId: offering.id, published: row.isPublished },
    });
    if (row.isPublished) {
      const enrollments = await prisma.enrollment.findMany({
        where: { offeringId: offering.id, status: 'ENROLLED' },
        select: { student: { select: { userId: true } } },
      });
      await notify({
        userIds: enrollments.map((enrollment) => enrollment.student.userId),
        type: 'SYSTEM',
        title: 'New learning material',
        body: `${row.title} is now available in your course.`,
        link: `/offerings/${offering.id}?tab=materials`,
      });
    }
    return sendData(res, row, { status: 201 });
  })
);

router.patch(
  '/materials/:id',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(materialSchema.partial()),
  asyncHandler(async (req, res) => {
    const existing = await prisma.courseMaterial.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) throw notFound('Learning material');
    const offering = await getManagedOffering(req.user!, existing.offeringId);
    const row = await prisma.courseMaterial.update({
      where: { id: existing.id },
      data: req.body,
      include: { createdBy: { select: { id: true, name: true } } },
    });
    await audit(req, { action: 'UPDATE', entityType: 'CourseMaterial', entityId: row.id, metadata: { fields: Object.keys(req.body) } });
    if (!existing.isPublished && row.isPublished) {
      const enrollments = await prisma.enrollment.findMany({
        where: { offeringId: offering.id, status: 'ENROLLED' },
        select: { student: { select: { userId: true } } },
      });
      await notify({
        userIds: enrollments.map((enrollment) => enrollment.student.userId),
        type: 'SYSTEM',
        title: 'New learning material',
        body: `${row.title} is now available in your course.`,
        link: `/offerings/${offering.id}?tab=materials`,
      });
    }
    return sendData(res, row);
  })
);

router.delete(
  '/materials/:id',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.courseMaterial.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) throw notFound('Learning material');
    await getManagedOffering(req.user!, existing.offeringId);
    await prisma.courseMaterial.delete({ where: { id: existing.id } });
    await audit(req, { action: 'DELETE', entityType: 'CourseMaterial', entityId: existing.id });
    return sendData(res, { id: existing.id });
  })
);

export default router;
