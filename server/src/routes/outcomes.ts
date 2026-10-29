import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/async-handler.js';
import { badRequest, conflict, notFound, forbidden } from '../lib/errors.js';
import { validate } from '../middleware/validate.js';
import { adminOnly, authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { sendData } from '../lib/http.js';
import { assertCourseAuthor, getStudentProfileId } from '../lib/authorization.js';

const router = Router();
router.use(authenticate);

const bloomLevels = ['REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYZE', 'EVALUATE', 'CREATE'] as const;
const bloomDomains = ['COGNITIVE', 'PSYCHOMOTOR', 'AFFECTIVE'] as const;

const cloCreateSchema = z.object({
  courseId: z.string().uuid(),
  code: z.string().trim().min(1).max(20),
  description: z.string().trim().min(10, 'Describe the measurable outcome').max(2000),
  bloomLevel: z.enum(bloomLevels),
  masteryThreshold: z.number().min(0).max(100).optional(),
  ploMappings: z
    .array(z.object({ ploId: z.string().uuid(), weight: z.number().int().min(1).max(3) }))
    .max(10)
    .optional(),
});

const cloUpdateSchema = z.object({
  description: z.string().trim().min(10).max(2000).optional(),
  bloomLevel: z.enum(bloomLevels).optional(),
  masteryThreshold: z.number().min(0).max(100).optional(),
  ploMappings: z
    .array(z.object({ ploId: z.string().uuid(), weight: z.number().int().min(1).max(3) }))
    .max(10)
    .optional(),
});

export async function visibleCourseIds(user: { id: string; role: string }): Promise<string[] | null> {
  if (user.role === 'ADMIN') return null;
  if (user.role === 'TUTOR') {
    const rows = await prisma.courseOffering.findMany({
      where: { tutorId: user.id },
      select: { courseId: true },
      distinct: ['courseId'],
    });
    return rows.map((row) => row.courseId);
  }
  const profileId = await getStudentProfileId(user.id);
  const rows = await prisma.enrollment.findMany({
    where: { studentId: profileId, status: { in: ['ENROLLED', 'COMPLETED'] } },
    select: { offering: { select: { courseId: true } } },
  });
  return [...new Set(rows.map((row) => row.offering.courseId))];
}

router.get(
  '/clos',
  asyncHandler(async (req, res) => {
    const { courseId, offeringId, programId } = req.query;
    const where: Record<string, unknown> = {};

    if (typeof courseId === 'string' && courseId) where.courseId = courseId;
    if (typeof programId === 'string' && programId) where.course = { programId };
    if (typeof offeringId === 'string' && offeringId) {
      const offering = await prisma.courseOffering.findUnique({ where: { id: offeringId }, select: { courseId: true, tutorId: true } });
      if (!offering) throw notFound('Course offering');
      if (req.user!.role === 'TUTOR' && offering.tutorId !== req.user!.id) {
        throw forbidden();
      }
      where.courseId = offering.courseId;
    }

    const courseIds = await visibleCourseIds(req.user!);
    if (courseIds !== null) {
      where.courseId = typeof where.courseId === 'string' ? where.courseId : { in: courseIds };
      if (typeof where.courseId === 'string' && !courseIds.includes(where.courseId)) {
        throw forbidden('You cannot view outcomes for this course');
      }
    }
    if (req.query.includeArchived !== 'true') where.archivedAt = null;
    if (req.user!.role === 'STUDENT') where.approvalStatus = 'APPROVED';

    const rows = await prisma.clo.findMany({
      where,
      include: {
        course: { select: { id: true, code: true, title: true, programId: true } },
        ploMappings: { include: { plo: { select: { id: true, code: true, description: true, targetAttainment: true } } } },
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        _count: { select: { itemMappings: true, attainment: true } },
      },
      orderBy: [{ course: { code: 'asc' } }, { code: 'asc' }],
    });
    return sendData(res, rows);
  })
);

router.post(
  '/clos',
  requireRole('ADMIN', 'TUTOR'),
  validate(cloCreateSchema),
  asyncHandler(async (req, res) => {
    const course = await assertCourseAuthor(req.user!, req.body.courseId);
    const { ploMappings, ...data } = req.body;

    if (ploMappings?.length) {
      const plos = await prisma.plo.findMany({
        where: { id: { in: ploMappings.map((mapping: { ploId: string }) => mapping.ploId) } },
        select: { id: true, programId: true },
      });
      if (plos.length !== new Set(ploMappings.map((mapping: { ploId: string }) => mapping.ploId)).size) {
        throw badRequest('One or more PLOs do not exist');
      }
      if (plos.some((plo) => plo.programId !== course.programId)) {
        throw badRequest('A CLO can only be mapped to a PLO in its own programme');
      }
    }

    const authorIsAdmin = req.user!.role === 'ADMIN';
    const row = await prisma.$transaction(async (tx) => {
      const clo = await tx.clo.create({
        data: {
          ...data,
          courseId: course.id,
          createdById: req.user!.id,
          ...(authorIsAdmin
            ? { approvalStatus: 'APPROVED', approvedById: req.user!.id, approvedAt: new Date() }
            : { approvalStatus: 'PENDING' }),
        },
      });
      if (ploMappings?.length) {
        await tx.cloPloMapping.createMany({
          data: ploMappings.map((mapping: { ploId: string; weight: number }) => ({
            cloId: clo.id,
            ploId: mapping.ploId,
            weight: mapping.weight,
          })),
        });
      }
      return tx.clo.findUniqueOrThrow({
        where: { id: clo.id },
        include: { ploMappings: { include: { plo: true } } },
      });
    });

    await audit(req, {
      action: 'INSERT',
      entityType: 'CLO',
      entityId: row.id,
      metadata: { courseId: course.id, code: row.code, approvalStatus: row.approvalStatus },
    });
    if (!authorIsAdmin) {
      const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
      await notify({
        userIds: admins.map((admin) => admin.id),
        type: 'SYSTEM',
        title: 'CLO awaiting approval',
        body: `${row.code} for ${course.code} was submitted by ${req.user!.name}.`,
        link: `/courses/${course.id}`,
      });
    }
    return sendData(res, row, { status: 201 });
  })
);

router.patch(
  '/clos/:id',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(cloUpdateSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.clo.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) throw notFound('CLO');
    await assertCourseAuthor(req.user!, existing.courseId);
    if (req.user!.role === 'TUTOR' && existing.approvalStatus === 'APPROVED') {
      throw forbidden('Approved CLOs can only be edited by an administrator');
    }
    if (req.user!.role === 'TUTOR' && existing.createdById !== req.user!.id) {
      throw forbidden('You can only edit CLOs you authored');
    }

    const { ploMappings, ...data } = req.body;
    if (ploMappings) {
      const course = await prisma.course.findUniqueOrThrow({ where: { id: existing.courseId } });
      const plos = await prisma.plo.findMany({
        where: { id: { in: ploMappings.map((mapping: { ploId: string }) => mapping.ploId) } },
        select: { id: true, programId: true },
      });
      if (plos.some((plo) => plo.programId !== course.programId)) {
        throw badRequest('A CLO can only be mapped to a PLO in its own programme');
      }
    }

    const row = await prisma.$transaction(async (tx) => {
      await tx.clo.update({ where: { id: existing.id }, data });
      if (ploMappings) {
        await tx.cloPloMapping.deleteMany({ where: { cloId: existing.id } });
        if (ploMappings.length) {
          await tx.cloPloMapping.createMany({
            data: ploMappings.map((mapping: { ploId: string; weight: number }) => ({
              cloId: existing.id,
              ploId: mapping.ploId,
              weight: mapping.weight,
            })),
          });
        }
      }
      return tx.clo.findUniqueOrThrow({
        where: { id: existing.id },
        include: { ploMappings: { include: { plo: true } } },
      });
    });
    await audit(req, { action: 'UPDATE', entityType: 'CLO', entityId: row.id, metadata: { fields: Object.keys(req.body) } });
    return sendData(res, row);
  })
);

router.post(
  '/clos/:id/approve',
  adminOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.clo.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) throw notFound('CLO');
    if (existing.approvalStatus === 'APPROVED') throw conflict('This CLO is already approved');
    const row = await prisma.clo.update({
      where: { id: existing.id },
      data: { approvalStatus: 'APPROVED', approvedById: req.user!.id, approvedAt: new Date(), rejectionNote: null },
    });
    await audit(req, { action: 'APPROVE', entityType: 'CLO', entityId: row.id });
    await notify({
      userIds: [existing.createdById],
      type: 'SYSTEM',
      title: 'CLO approved',
      body: `${row.code} has been approved and is now available to students.`,
      link: `/courses/${row.courseId}`,
    });
    return sendData(res, row);
  })
);

router.post(
  '/clos/:id/reject',
  adminOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(z.object({ note: z.string().trim().min(5).max(1000) })),
  asyncHandler(async (req, res) => {
    const existing = await prisma.clo.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) throw notFound('CLO');
    const row = await prisma.clo.update({
      where: { id: existing.id },
      data: { approvalStatus: 'REJECTED', approvedById: req.user!.id, approvedAt: new Date(), rejectionNote: req.body.note },
    });
    await audit(req, { action: 'REJECT', entityType: 'CLO', entityId: row.id, metadata: { note: req.body.note } });
    await notify({
      userIds: [existing.createdById],
      type: 'SYSTEM',
      title: 'CLO returned for revision',
      body: `${row.code}: ${req.body.note}`,
      link: `/courses/${row.courseId}`,
    });
    return sendData(res, row);
  })
);

router.delete(
  '/clos/:id',
  adminOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.clo.findUnique({
      where: { id: String(req.params.id) },
      include: { _count: { select: { itemMappings: true, attainment: true } } },
    });
    if (!existing) throw notFound('CLO');
    if (existing._count.itemMappings > 0 || existing._count.attainment > 0) {
      throw conflict('This CLO has assessment evidence or attainment history and cannot be deleted');
    }
    await prisma.clo.delete({ where: { id: existing.id } });
    await audit(req, { action: 'DELETE', entityType: 'CLO', entityId: existing.id, metadata: { code: existing.code } });
    return sendData(res, { id: existing.id });
  })
);

// Archiving is the safe alternative to deletion: the row (and therefore any
// future evidence linkage) is retained, but the CLO is hidden from active
// lists. A CLO that already carries assessment or attainment evidence cannot
// be archived because that would silently change reported results.
router.post(
  '/clos/:id/archive',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.clo.findUnique({
      where: { id: String(req.params.id) },
      include: { _count: { select: { itemMappings: true, attainment: true } } },
    });
    if (!existing) throw notFound('CLO');
    await assertCourseAuthor(req.user!, existing.courseId);
    if (existing._count.itemMappings > 0 || existing._count.attainment > 0) {
      throw conflict('This CLO has assessment evidence or attainment history and cannot be archived');
    }
    const row = await prisma.clo.update({ where: { id: existing.id }, data: { archivedAt: new Date() } });
    await audit(req, { action: 'ARCHIVE', entityType: 'CLO', entityId: row.id, metadata: { code: row.code } });
    return sendData(res, row);
  })
);

router.post(
  '/clos/:id/unarchive',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.clo.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) throw notFound('CLO');
    await assertCourseAuthor(req.user!, existing.courseId);
    const row = await prisma.clo.update({ where: { id: existing.id }, data: { archivedAt: null } });
    await audit(req, { action: 'RESTORE', entityType: 'CLO', entityId: row.id, metadata: { code: row.code } });
    return sendData(res, row);
  })
);

/* ------------------------------- PLOs -------------------------------- */
const ploSchema = z.object({
  programId: z.string().uuid(),
  code: z.string().trim().min(1).max(20),
  description: z.string().trim().min(10).max(2000),
  bloomDomain: z.enum(bloomDomains),
  accreditationRef: z.string().trim().max(120).optional().nullable(),
  targetAttainment: z.number().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
});

router.get(
  '/plos',
  asyncHandler(async (req, res) => {
    const { programId } = req.query;
    const where: Record<string, unknown> = {};
    if (typeof programId === 'string' && programId) where.programId = programId;

    if (req.user!.role === 'STUDENT') {
      const profileId = await getStudentProfileId(req.user!.id);
      const profile = await prisma.studentProfile.findUnique({ where: { id: profileId } });
      where.programId = profile?.programId;
      where.isActive = true;
    } else if (req.user!.role === 'TUTOR') {
      const courseIds = (await visibleCourseIds(req.user!)) ?? [];
      const courses = await prisma.course.findMany({ where: { id: { in: courseIds } }, select: { programId: true } });
      where.programId = { in: [...new Set(courses.map((course) => course.programId))] };
    }

    const rows = await prisma.plo.findMany({
      where,
      include: {
        program: { select: { id: true, code: true, name: true } },
        _count: { select: { cloMappings: true, attainment: true } },
      },
      orderBy: [{ program: { code: 'asc' } }, { code: 'asc' }],
    });
    return sendData(res, rows);
  })
);

router.post(
  '/plos',
  adminOnly,
  validate(ploSchema),
  asyncHandler(async (req, res) => {
    const row = await prisma.plo.create({ data: req.body });
    await audit(req, { action: 'INSERT', entityType: 'PLO', entityId: row.id, metadata: { code: row.code } });
    return sendData(res, row, { status: 201 });
  })
);

router.patch(
  '/plos/:id',
  adminOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(ploSchema.partial().omit({ programId: true })),
  asyncHandler(async (req, res) => {
    const row = await prisma.plo.update({ where: { id: String(req.params.id) }, data: req.body });
    await audit(req, { action: 'UPDATE', entityType: 'PLO', entityId: row.id });
    return sendData(res, row);
  })
);

router.delete(
  '/plos/:id',
  adminOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const row = await prisma.plo.update({ where: { id: String(req.params.id) }, data: { isActive: false } });
    await audit(req, { action: 'UPDATE', entityType: 'PLO', entityId: row.id, metadata: { deactivated: true } });
    return sendData(res, row);
  })
);

/* --------------------------- CLO↔PLO mappings ------------------------- */
// A mapping that already contributed to a frozen attainment run is immutable:
// changing it would retroactively alter accreditation evidence.
async function assertMappingNotFrozen(cloId: string) {
  const frozen = await prisma.cloAttainment.findFirst({
    where: { cloId, run: { isFrozen: true } },
    select: { id: true },
  });
  if (frozen) {
    throw conflict('This CLO is part of a frozen attainment run; its PLO mappings cannot be changed');
  }
}

router.get(
  '/clo-plo-mappings',
  asyncHandler(async (req, res) => {
    const { cloId, ploId, programId } = req.query;
    const courseIds = await visibleCourseIds(req.user!);
    const where: Record<string, unknown> = {
      ...(typeof cloId === 'string' && cloId ? { cloId } : {}),
      ...(typeof ploId === 'string' && ploId ? { ploId } : {}),
      ...(typeof programId === 'string' && programId ? { plo: { programId } } : {}),
      ...(courseIds !== null ? { clo: { courseId: { in: courseIds } } } : {}),
    };
    const rows = await prisma.cloPloMapping.findMany({
      where,
      include: {
        clo: { select: { id: true, code: true, description: true, course: { select: { id: true, code: true } } } },
        plo: { select: { id: true, code: true, description: true, targetAttainment: true } },
      },
      orderBy: [{ clo: { code: 'asc' } }, { plo: { code: 'asc' } }],
    });
    return sendData(res, rows);
  })
);

router.post(
  '/clo-plo-mappings',
  requireRole('ADMIN', 'TUTOR'),
  validate(
    z.object({
      cloId: z.string().uuid(),
      ploId: z.string().uuid(),
      weight: z.number().int().min(1).max(3).default(3),
    })
  ),
  asyncHandler(async (req, res) => {
    const [clo, plo] = await Promise.all([
      prisma.clo.findUnique({ where: { id: req.body.cloId }, include: { course: true } }),
      prisma.plo.findUnique({ where: { id: req.body.ploId } }),
    ]);
    if (!clo) throw notFound('CLO');
    if (!plo) throw notFound('PLO');
    // Tutors may only map outcomes for courses they actually teach, and never
    // across programmes. Administrators keep institutional authority.
    await assertCourseAuthor(req.user!, clo.courseId);
    if (clo.archivedAt) throw conflict('An archived CLO cannot be remapped');
    if (clo.course.programId !== plo.programId) {
      throw badRequest('CLO and PLO must belong to the same programme');
    }
    await assertMappingNotFrozen(clo.id);
    const row = await prisma.cloPloMapping.upsert({
      where: { cloId_ploId: { cloId: req.body.cloId, ploId: req.body.ploId } },
      create: req.body,
      update: { weight: req.body.weight },
    });
    await audit(req, { action: 'UPDATE', entityType: 'CLO_PLO_Mapping', entityId: row.id, metadata: req.body });
    return sendData(res, row, { status: 201 });
  })
);

router.delete(
  '/clo-plo-mappings/:id',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const mapping = await prisma.cloPloMapping.findUnique({
      where: { id: String(req.params.id) },
      include: { clo: { select: { id: true, courseId: true } } },
    });
    if (!mapping) throw notFound('CLO–PLO mapping');
    await assertCourseAuthor(req.user!, mapping.clo.courseId);
    await assertMappingNotFrozen(mapping.clo.id);
    const row = await prisma.cloPloMapping.delete({ where: { id: mapping.id } });
    await audit(req, { action: 'DELETE', entityType: 'CLO_PLO_Mapping', entityId: row.id });
    return sendData(res, { id: row.id });
  })
);

export default router;
