import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/async-handler.js';
import { badRequest, conflict, notFound, forbidden } from '../lib/errors.js';
import { validate } from '../middleware/validate.js';
import { adminOnly, authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { hashPassword } from '../lib/password.js';
import { readPagination, sendData, sendPaginated } from '../lib/http.js';
import { getStudentProfileId } from '../lib/authorization.js';
import type { Prisma, Role } from '@prisma/client';

const router = Router();
router.use(authenticate);

/* ------------------------------------------------------------------ */
/* Departments                                                         */
/* ------------------------------------------------------------------ */
const departmentSchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().min(1).max(16).regex(/^[A-Z0-9-]+$/, 'Use uppercase letters, digits or hyphens'),
  hodName: z.string().trim().max(160).optional().nullable(),
  contact: z.string().trim().max(120).optional().nullable(),
  isActive: z.boolean().optional(),
});

router.get(
  '/departments',
  asyncHandler(async (req, res) => {
    const { q, isActive } = req.query;
    const rows = await prisma.department.findMany({
      where: {
        ...(typeof q === 'string' && q.trim()
          ? { OR: [{ name: { contains: q.trim(), mode: 'insensitive' } }, { code: { contains: q.trim(), mode: 'insensitive' } }] }
          : {}),
        ...(isActive === 'true' ? { isActive: true } : isActive === 'false' ? { isActive: false } : {}),
      },
      include: { _count: { select: { programs: true, users: true } } },
      orderBy: { name: 'asc' },
    });
    return sendData(res, rows);
  })
);

router.post(
  '/departments',
  adminOnly,
  validate(departmentSchema),
  asyncHandler(async (req, res) => {
    const row = await prisma.department.create({ data: req.body });
    await audit(req, { action: 'INSERT', entityType: 'Department', entityId: row.id, metadata: { code: row.code } });
    return sendData(res, row, { status: 201 });
  })
);

router.patch(
  '/departments/:id',
  adminOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(departmentSchema.partial()),
  asyncHandler(async (req, res) => {
    const row = await prisma.department.update({ where: { id: String(req.params.id) }, data: req.body });
    await audit(req, { action: 'UPDATE', entityType: 'Department', entityId: row.id });
    return sendData(res, row);
  })
);

router.delete(
  '/departments/:id',
  adminOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const row = await prisma.department.update({ where: { id: String(req.params.id) }, data: { isActive: false } });
    await audit(req, { action: 'UPDATE', entityType: 'Department', entityId: row.id, metadata: { deactivated: true } });
    return sendData(res, row);
  })
);

/* ------------------------------------------------------------------ */
/* Programs                                                            */
/* ------------------------------------------------------------------ */
const programSchema = z.object({
  departmentId: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().min(1).max(16).regex(/^[A-Z0-9-]+$/),
  creditHours: z.number().int().min(1).max(400),
  accreditationBody: z.enum(['PEC', 'ABET', 'HEC', 'OTHER']).optional().nullable(),
  isActive: z.boolean().optional(),
});

router.get(
  '/programs',
  asyncHandler(async (req, res) => {
    const { departmentId, q } = req.query;
    const where: Record<string, unknown> = {};
    if (typeof departmentId === 'string' && departmentId) where.departmentId = departmentId;
    if (typeof q === 'string' && q.trim()) {
      where.OR = [
        { name: { contains: q.trim(), mode: 'insensitive' } },
        { code: { contains: q.trim(), mode: 'insensitive' } },
      ];
    }
    if (req.user!.role === 'STUDENT') {
      const profileId = await getStudentProfileId(req.user!.id);
      const profile = await prisma.studentProfile.findUnique({ where: { id: profileId }, select: { programId: true } });
      where.id = profile?.programId;
    }
    const rows = await prisma.program.findMany({
      where,
      include: { department: { select: { id: true, name: true, code: true } }, _count: { select: { courses: true, plos: true, students: true } } },
      orderBy: { name: 'asc' },
    });
    return sendData(res, rows);
  })
);

router.post(
  '/programs',
  adminOnly,
  validate(programSchema),
  asyncHandler(async (req, res) => {
    const row = await prisma.program.create({ data: req.body });
    await audit(req, { action: 'INSERT', entityType: 'Program', entityId: row.id, metadata: { code: row.code } });
    return sendData(res, row, { status: 201 });
  })
);

router.patch(
  '/programs/:id',
  adminOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(programSchema.partial()),
  asyncHandler(async (req, res) => {
    const row = await prisma.program.update({ where: { id: String(req.params.id) }, data: req.body });
    await audit(req, { action: 'UPDATE', entityType: 'Program', entityId: row.id });
    return sendData(res, row);
  })
);

router.delete(
  '/programs/:id',
  adminOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const row = await prisma.program.update({ where: { id: String(req.params.id) }, data: { isActive: false } });
    await audit(req, { action: 'UPDATE', entityType: 'Program', entityId: row.id, metadata: { deactivated: true } });
    return sendData(res, row);
  })
);

/* ------------------------------------------------------------------ */
/* Semesters                                                           */
/* ------------------------------------------------------------------ */
const semesterBaseSchema = z.object({
  name: z.string().trim().min(3).max(80),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  isActive: z.boolean().optional(),
});

const semesterSchema = semesterBaseSchema.refine((value) => value.endDate > value.startDate, {
  message: 'End date must be after start date',
  path: ['endDate'],
});

router.get(
  '/semesters',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.semester.findMany({
      include: { _count: { select: { offerings: true } } },
      orderBy: [{ isActive: 'desc' }, { startDate: 'desc' }],
    });
    return sendData(res, rows);
  })
);

router.post(
  '/semesters',
  adminOnly,
  validate(semesterSchema),
  asyncHandler(async (req, res) => {
    const { isActive, ...data } = req.body;
    const row = await prisma.$transaction(async (tx) => {
      if (isActive) await tx.semester.updateMany({ where: { isActive: true }, data: { isActive: false } });
      return tx.semester.create({ data: { ...data, isActive: Boolean(isActive) } });
    });
    await audit(req, { action: 'INSERT', entityType: 'Semester', entityId: row.id, metadata: { name: row.name } });
    if (isActive) {
      const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
      await notify({
        userIds: admins.map((admin) => admin.id),
        type: 'SYSTEM',
        title: 'Active academic session changed',
        body: `${row.name} is now the active session.`,
        link: '/semesters',
      });
    }
    return sendData(res, row, { status: 201 });
  })
);

router.patch(
  '/semesters/:id',
  adminOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(semesterBaseSchema.partial()),
  asyncHandler(async (req, res) => {
    const { isActive, ...data } = req.body;
    const row = await prisma.$transaction(async (tx) => {
      if (isActive) await tx.semester.updateMany({ where: { isActive: true, NOT: { id: String(req.params.id) } }, data: { isActive: false } });
      return tx.semester.update({ where: { id: String(req.params.id) }, data: { ...data, ...(isActive === undefined ? {} : { isActive }) } });
    });
    await audit(req, { action: 'UPDATE', entityType: 'Semester', entityId: row.id });
    return sendData(res, row);
  })
);

router.delete(
  '/semesters/:id',
  adminOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const offerings = await prisma.courseOffering.count({ where: { semesterId: String(req.params.id) } });
    if (offerings > 0) throw conflict('This session has course offerings and cannot be deleted');
    await prisma.semester.delete({ where: { id: String(req.params.id) } });
    await audit(req, { action: 'DELETE', entityType: 'Semester', entityId: String(req.params.id) });
    return sendData(res, { id: String(req.params.id) });
  })
);

/* ------------------------------------------------------------------ */
/* Courses                                                             */
/* ------------------------------------------------------------------ */
const courseSchema = z.object({
  programId: z.string().uuid(),
  code: z.string().trim().min(1).max(24),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  creditHours: z.number().int().min(1).max(6),
  isActive: z.boolean().optional(),
});

export async function courseViewerFilter(user: { id: string; role: Role }): Promise<Prisma.CourseWhereInput> {
  if (user.role === 'ADMIN') return {};
  if (user.role === 'TUTOR') return { offerings: { some: { tutorId: user.id } } };
  const profileId = await getStudentProfileId(user.id);
  return {
    offerings: {
      some: { enrollments: { some: { studentId: profileId, status: { in: ['ENROLLED', 'COMPLETED'] } } } },
    },
  };
}

router.get(
  '/courses',
  asyncHandler(async (req, res) => {
    const { programId, q, isActive } = req.query;
    const pagination = readPagination(req.query as Record<string, unknown>);
    const scope = await courseViewerFilter(req.user!);
    const where: Prisma.CourseWhereInput = {
      ...scope,
      ...(typeof programId === 'string' && programId ? { programId } : {}),
      ...(typeof q === 'string' && q.trim()
        ? { OR: [{ title: { contains: q.trim(), mode: 'insensitive' as const } }, { code: { contains: q.trim(), mode: 'insensitive' as const } }] }
        : {}),
      ...(isActive === 'false' ? { isActive: false } : { isActive: true }),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.course.findMany({
        where,
        include: {
          program: { select: { id: true, code: true, name: true } },
          _count: { select: { clos: true, offerings: true } },
        },
        orderBy: [{ code: 'asc' }],
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.course.count({ where }),
    ]);
    return sendPaginated(res, rows, pagination, total);
  })
);

router.get(
  '/courses/:id',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const scope = await courseViewerFilter(req.user!);
    const row = await prisma.course.findFirst({
      where: { id: String(req.params.id), ...scope },
      include: {
        program: { select: { id: true, code: true, name: true, departmentId: true } },
        clos: { orderBy: { code: 'asc' }, include: { ploMappings: { include: { plo: true } } } },
        offerings: { include: { semester: true, tutor: { select: { id: true, name: true } } } },
      },
    });
    if (!row) throw notFound('Course');
    return sendData(res, row);
  })
);

router.post(
  '/courses',
  adminOnly,
  validate(courseSchema),
  asyncHandler(async (req, res) => {
    const row = await prisma.course.create({ data: req.body });
    await audit(req, { action: 'INSERT', entityType: 'Course', entityId: row.id, metadata: { code: row.code } });
    return sendData(res, row, { status: 201 });
  })
);

router.patch(
  '/courses/:id',
  adminOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(courseSchema.partial()),
  asyncHandler(async (req, res) => {
    const row = await prisma.course.update({ where: { id: String(req.params.id) }, data: req.body });
    await audit(req, { action: 'UPDATE', entityType: 'Course', entityId: row.id });
    return sendData(res, row);
  })
);

router.delete(
  '/courses/:id',
  adminOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const row = await prisma.course.update({ where: { id: String(req.params.id) }, data: { isActive: false } });
    await audit(req, { action: 'UPDATE', entityType: 'Course', entityId: row.id, metadata: { deactivated: true } });
    return sendData(res, row);
  })
);

/* ------------------------------------------------------------------ */
/* Users and students                                                  */
/* ------------------------------------------------------------------ */
const userCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['ADMIN', 'TUTOR', 'STUDENT']),
  password: z.string().min(10).max(200),
  departmentId: z.string().uuid().optional().nullable(),
  employeeNo: z.string().trim().max(40).optional().nullable(),
  studentProfile: z
    .object({
      rollNo: z.string().trim().min(1).max(40),
      programId: z.string().uuid(),
      batch: z.string().trim().max(20).optional().nullable(),
    })
    .optional(),
});

router.get(
  '/users',
  adminOnly,
  asyncHandler(async (req, res) => {
    const pagination = readPagination(req.query as Record<string, unknown>);
    const roleQuery = req.query.role;
    const role: Role | undefined =
      roleQuery === 'ADMIN' || roleQuery === 'TUTOR' || roleQuery === 'STUDENT' ? roleQuery : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const where: Prisma.UserWhereInput = {
      ...(role ? { role } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' as const } },
              { email: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          employeeNo: true,
          isActive: true,
          departmentId: true,
          lastLoginAt: true,
          createdAt: true,
          department: { select: { id: true, name: true } },
          studentProfile: { select: { id: true, rollNo: true, batch: true, program: { select: { id: true, code: true, name: true } } } },
        },
        orderBy: { name: 'asc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.user.count({ where }),
    ]);
    return sendPaginated(res, rows, pagination, total);
  })
);

router.post(
  '/users',
  adminOnly,
  validate(userCreateSchema),
  asyncHandler(async (req, res) => {
    const { password, studentProfile, ...data } = req.body;
    if (data.role === 'STUDENT' && !studentProfile) {
      throw badRequest('A student account requires a student profile (roll number and programme)');
    }
    if (data.role !== 'STUDENT' && studentProfile) {
      throw badRequest('Student profile is only valid for student accounts');
    }
    if (data.role !== 'STUDENT') {
      if (!data.departmentId) throw badRequest('Department is required for staff accounts');
    }
    const passwordHash = await hashPassword(password);
    const row = await prisma.$transaction(async (tx) => {
      let departmentId = data.departmentId ?? null;
      if (studentProfile) {
        const program = await tx.program.findUnique({ where: { id: studentProfile.programId } });
        if (!program) throw notFound('Programme');
        departmentId = departmentId ?? program.departmentId;
      }
      return tx.user.create({
        data: {
          ...data,
          departmentId,
          passwordHash,
          ...(studentProfile
            ? {
                studentProfile: {
                  create: {
                    rollNo: studentProfile.rollNo,
                    programId: studentProfile.programId,
                    batch: studentProfile.batch ?? null,
                  },
                },
              }
            : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          studentProfile: { select: { id: true, rollNo: true, programId: true } },
        },
      });
    });
    await audit(req, {
      action: 'INSERT',
      entityType: 'User',
      entityId: row.id,
      metadata: { role: row.role, email: row.email },
    });
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
    await notify({
      userIds: admins.filter((admin) => admin.id !== row.id).map((admin) => admin.id),
      type: 'SYSTEM',
      title: 'New account created',
      body: `${row.name} was added as ${row.role.toLowerCase()}.`,
      link: '/users',
    });
    return sendData(res, row, { status: 201 });
  })
);

router.patch(
  '/users/:id',
  adminOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(
    z.object({
      name: z.string().trim().min(2).max(160).optional(),
      email: z.string().trim().toLowerCase().email().optional(),
      isActive: z.boolean().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    if (String(req.params.id) === req.user!.id && req.body.isActive === false) {
      throw badRequest('You cannot deactivate your own administrator account');
    }
    const row = await prisma.user.update({
      where: { id: String(req.params.id) },
      data: req.body,
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });
    await audit(req, { action: 'UPDATE', entityType: 'User', entityId: row.id, metadata: { fields: Object.keys(req.body) } });
    return sendData(res, row);
  })
);

router.post(
  '/users/:id/reset-password',
  adminOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(z.object({ password: z.string().min(10).max(200) })),
  asyncHandler(async (req, res) => {
    const passwordHash = await hashPassword(req.body.password);
    await prisma.$transaction([
      prisma.user.update({ where: { id: String(req.params.id) }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } }),
      prisma.refreshToken.updateMany({ where: { userId: String(req.params.id), revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await audit(req, { action: 'UPDATE', entityType: 'User', entityId: String(req.params.id), metadata: { field: 'password_reset' } });
    return sendData(res, { ok: true });
  })
);

router.get(
  '/students',
  requireRole('ADMIN', 'TUTOR'),
  asyncHandler(async (req, res) => {
    const pagination = readPagination(req.query as Record<string, unknown>);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const programId = typeof req.query.programId === 'string' ? req.query.programId : undefined;
    const offeringId = typeof req.query.offeringId === 'string' ? req.query.offeringId : undefined;

    const where: Record<string, unknown> = {
      ...(programId ? { programId } : {}),
      ...(offeringId ? { enrollments: { some: { offeringId, status: { in: ['ENROLLED', 'COMPLETED'] } } } } : {}),
      ...(q
        ? {
            OR: [
              { rollNo: { contains: q, mode: 'insensitive' } },
              { user: { name: { contains: q, mode: 'insensitive' } } },
              { user: { email: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
      ...(req.user!.role === 'TUTOR'
        ? { enrollments: { some: { offering: { tutorId: req.user!.id } } } }
        : {}),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.studentProfile.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, isActive: true } },
          program: { select: { id: true, code: true, name: true } },
          _count: { select: { enrollments: true } },
        },
        orderBy: { rollNo: 'asc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.studentProfile.count({ where }),
    ]);
    return sendPaginated(res, rows, pagination, total);
  })
);

router.get(
  '/students/me',
  requireRole('STUDENT'),
  asyncHandler(async (req, res) => {
    const profileId = await getStudentProfileId(req.user!.id);
    const row = await prisma.studentProfile.findUnique({
      where: { id: profileId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        program: { select: { id: true, code: true, name: true } },
        enrollments: {
          include: {
            offering: {
              include: {
                course: true,
                semester: true,
                tutor: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { enrolledAt: 'desc' },
        },
      },
    });
    if (!row) throw forbidden('No student profile is linked to this account');
    return sendData(res, row);
  })
);

export default router;
