import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/async-handler.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { validate } from '../middleware/validate.js';
import { adminOnly, authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { readPagination, sendData, sendPaginated } from '../lib/http.js';
import { getManagedOffering, getOfferingForViewer, getStudentProfileId } from '../lib/authorization.js';

const router = Router();
router.use(authenticate);

const offeringSchema = z.object({
  courseId: z.string().uuid(),
  semesterId: z.string().uuid(),
  tutorId: z.string().uuid(),
  sectionName: z.string().trim().min(1).max(80),
  status: z.enum(['PLANNED', 'ACTIVE', 'COMPLETED', 'ARCHIVED']).optional(),
  reportingPeriod: z.string().trim().max(80).optional().nullable(),
});

async function assertTutor(tutorId: string) {
  const tutor = await prisma.user.findUnique({ where: { id: tutorId }, select: { role: true, isActive: true, name: true } });
  if (!tutor || tutor.role !== 'TUTOR') throw badRequest('The selected user is not a tutor');
  if (!tutor.isActive) throw badRequest('The selected tutor account is inactive');
  return tutor;
}

router.get(
  '/offerings',
  asyncHandler(async (req, res) => {
    const pagination = readPagination(req.query as Record<string, unknown>);
    const { courseId, semesterId, tutorId, programId, status } = req.query;
    const where: Record<string, unknown> = {
      ...(typeof courseId === 'string' && courseId ? { courseId } : {}),
      ...(typeof semesterId === 'string' && semesterId ? { semesterId } : {}),
      ...(typeof tutorId === 'string' && tutorId ? { tutorId } : {}),
      ...(typeof programId === 'string' && programId ? { course: { programId } } : {}),
      ...(typeof status === 'string' && status ? { status } : {}),
    };

    if (req.user!.role === 'TUTOR') where.tutorId = req.user!.id;
    if (req.user!.role === 'STUDENT') {
      const profileId = await getStudentProfileId(req.user!.id);
      where.enrollments = { some: { studentId: profileId, status: { in: ['ENROLLED', 'COMPLETED'] } } };
    }

    const [rows, total] = await prisma.$transaction([
      prisma.courseOffering.findMany({
        where,
        include: {
          course: { select: { id: true, code: true, title: true, programId: true, program: { select: { id: true, code: true, name: true } } } },
          semester: { select: { id: true, name: true, isActive: true } },
          tutor: { select: { id: true, name: true, email: true } },
          _count: { select: { enrollments: true, assessments: true } },
          attainmentRuns: {
            orderBy: { computedAt: 'desc' },
            take: 1,
            select: { id: true, computedAt: true, isFrozen: true, policyVersion: true },
          },
        },
        orderBy: [{ semester: { startDate: 'desc' } }, { course: { code: 'asc' } }, { sectionName: 'asc' }],
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.courseOffering.count({ where }),
    ]);
    return sendPaginated(res, rows, pagination, total);
  })
);

router.post(
  '/offerings',
  adminOnly,
  validate(offeringSchema),
  asyncHandler(async (req, res) => {
    await assertTutor(req.body.tutorId);
    const [course, semester] = await Promise.all([
      prisma.course.findUnique({ where: { id: req.body.courseId } }),
      prisma.semester.findUnique({ where: { id: req.body.semesterId } }),
    ]);
    if (!course) throw notFound('Course');
    if (!semester) throw notFound('Academic session');
    const row = await prisma.courseOffering.create({
      data: req.body,
      include: {
        course: { select: { code: true, title: true } },
        semester: { select: { name: true } },
        tutor: { select: { id: true, name: true } },
      },
    });
    await audit(req, {
      action: 'INSERT',
      entityType: 'CourseOffering',
      entityId: row.id,
      metadata: { courseId: row.courseId, tutorId: row.tutorId, semesterId: row.semesterId },
    });
    await notify({
      userIds: [row.tutorId],
      type: 'COURSE_ASSIGNMENT',
      title: 'New course assignment',
      body: `You have been assigned ${row.course.code} — ${row.course.title} (${row.sectionName ?? ''}, ${row.semester.name}).`,
      link: `/offerings/${row.id}`,
    });
    return sendData(res, row, { status: 201 });
  })
);

router.get(
  '/offerings/:id',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const offering = await getOfferingForViewer(req.user!, String(req.params.id));
    const isManager = req.user!.role === 'ADMIN' || req.user!.role === 'TUTOR';

    const detail = await prisma.courseOffering.findUnique({
      where: { id: offering.id },
      include: {
        course: {
          include: {
            program: { select: { id: true, code: true, name: true } },
            clos: {
              where: isManager ? { archivedAt: null } : { approvalStatus: 'APPROVED', archivedAt: null },
              orderBy: { code: 'asc' },
              include: { ploMappings: { include: { plo: true } } },
            },
          },
        },
        semester: true,
        tutor: { select: { id: true, name: true, email: true } },
        ...(isManager
          ? {
              enrollments: {
                include: {
                  student: {
                    include: {
                      user: { select: { id: true, name: true, email: true, isActive: true } },
                    },
                  },
                },
                orderBy: { student: { rollNo: 'asc' } },
              },
            }
          : {
              enrollments: {
                where: { student: { userId: req.user!.id } },
                select: { id: true, status: true, enrolledAt: true },
              },
            }),
        assessments: {
          where: isManager ? {} : { status: { in: ['PUBLISHED', 'CLOSED'] } },
          include: { _count: { select: { items: true, submissions: true } } },
          orderBy: { createdAt: 'desc' },
        },
        attainmentRuns: {
          orderBy: { computedAt: 'desc' },
          take: 3,
          select: {
            id: true,
            computedAt: true,
            isFrozen: true,
            policyVersion: true,
            engineVersion: true,
            reportingPeriod: true,
            _count: { select: { cloResults: true, ploResults: true } },
          },
        },
      },
    });
    if (!detail) throw notFound('Course offering');
    return sendData(res, detail);
  })
);

router.patch(
  '/offerings/:id',
  adminOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(offeringSchema.partial()),
  asyncHandler(async (req, res) => {
    if (req.body.tutorId) await assertTutor(req.body.tutorId);
    const previous = await prisma.courseOffering.findUnique({ where: { id: String(req.params.id) } });
    if (!previous) throw notFound('Course offering');
    const row = await prisma.courseOffering.update({
      where: { id: String(req.params.id) },
      data: req.body,
      include: {
        course: { select: { code: true, title: true } },
        tutor: { select: { id: true, name: true } },
      },
    });
    await audit(req, {
      action: 'UPDATE',
      entityType: 'CourseOffering',
      entityId: row.id,
      metadata: { fields: Object.keys(req.body) },
    });
    if (req.body.tutorId && req.body.tutorId !== previous.tutorId) {
      await notify({
        userIds: [req.body.tutorId, previous.tutorId],
        type: 'COURSE_ASSIGNMENT',
        title: 'Course assignment changed',
        body: `${row.course.code} — ${row.course.title} is now assigned to ${row.tutor.name}.`,
        link: `/offerings/${row.id}`,
      });
    }
    return sendData(res, row);
  })
);

router.delete(
  '/offerings/:id',
  adminOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const row = await prisma.courseOffering.update({
      where: { id: String(req.params.id) },
      data: { status: 'ARCHIVED' },
    });
    await audit(req, { action: 'UPDATE', entityType: 'CourseOffering', entityId: row.id, metadata: { archived: true } });
    return sendData(res, row);
  })
);

/* ------------------------- Roster progress ----------------------------- */
// Per-student progress indicators for a single offering. The figures are
// derived only from persisted, publication-gated evidence:
//  - submissionsCount / assessmentsCount  (all published assessments of the offering)
//  - averageEarnedPct, publishedAssessmentCount / totalAssessmentsCount (grades that
//    have actually been published to students; unpublished marks never leak)
//  - cloMastery: per-CLO mastery from the offering's latest attainment run, but
//    only for students who are enrolled. Missing evidence is surfaced as
//    null + INSUFFICIENT_DATA, never as a fabricated number.
router.get(
  '/offerings/:id/roster-progress',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const managedOffering = await getManagedOffering(req.user!, String(req.params.id));
    const offering = await prisma.courseOffering.findUniqueOrThrow({
      where: { id: managedOffering.id },
      include: {
        course: { select: { code: true, title: true } },
        semester: { select: { name: true } },
      },
    });

    const [enrollments, allAssessments, latestRun] = await Promise.all([
      prisma.enrollment.findMany({
        where: { offeringId: offering.id, status: { in: ['ENROLLED', 'COMPLETED'] } },
        include: { student: { include: { user: { select: { id: true, name: true, email: true } } } } },
        orderBy: { student: { rollNo: 'asc' } },
      }),
      prisma.assessment.count({ where: { offeringId: offering.id, status: { in: ['PUBLISHED', 'CLOSED'] } } }),
      prisma.attainmentRun.findFirst({
        where: { offeringId: offering.id },
        include: {
          cloResults: {
            include: { clo: { select: { code: true, description: true, masteryThreshold: true } } },
          },
        },
        orderBy: { computedAt: 'desc' },
      }),
    ]);

    // Read every submission for this offering so the roster can distinguish
    // submitted, pending, graded-but-unpublished and published evidence. The
    // offering predicate is deliberate: student IDs can be enrolled in more
    // than one offering, so a student lookup alone would leak cross-course
    // progress into this roster.
    const studentIds = enrollments.map((enrollment) => enrollment.studentId);
    const submissions =
      studentIds.length && allAssessments > 0
        ? await prisma.submission.findMany({
            where: {
              studentId: { in: studentIds },
              assessment: { offeringId: offering.id, status: { in: ['PUBLISHED', 'CLOSED'] } },
            },
            select: {
              studentId: true,
              assessmentId: true,
              status: true,
              assessment: { select: { resultsPublishedAt: true } },
              grades: { select: { marks: true, item: { select: { maxMarks: true } } } },
            },
          })
        : [];

    const earnedByStudent = new Map<string, { earned: number; max: number; assessmentsCount: number }>();
    const submittedByStudent = new Map<string, number>();
    const pendingByStudent = new Map<string, number>();
    const unpublishedByStudent = new Map<string, number>();
    for (const row of submissions) {
      submittedByStudent.set(row.studentId, (submittedByStudent.get(row.studentId) ?? 0) + 1);
      if (row.status === 'SUBMITTED' || row.status === 'LATE') {
        pendingByStudent.set(row.studentId, (pendingByStudent.get(row.studentId) ?? 0) + 1);
        continue;
      }
      if (!row.assessment.resultsPublishedAt) {
        unpublishedByStudent.set(row.studentId, (unpublishedByStudent.get(row.studentId) ?? 0) + 1);
        continue;
      }
      if (row.status !== 'GRADED' && row.status !== 'RETURNED') continue;
      const entry = earnedByStudent.get(row.studentId) ?? { earned: 0, max: 0, assessmentsCount: 0 };
      entry.earned += row.grades.reduce((sum, grade) => sum + Number(grade.marks), 0);
      entry.max += row.grades.reduce((sum, grade) => sum + Number(grade.item.maxMarks), 0);
      entry.assessmentsCount += 1;
      earnedByStudent.set(row.studentId, entry);
    }

    const roster = enrollments.map((enrollment) => {
      const gradeTotals = earnedByStudent.get(enrollment.studentId);
      const pct =
        gradeTotals && gradeTotals.max > 0 ? Math.round((gradeTotals.earned / gradeTotals.max) * 1000) / 10 : null;
      return {
        enrollmentId: enrollment.id,
        student: {
          id: enrollment.student.id,
          rollNo: enrollment.student.rollNo,
          name: enrollment.student.user.name,
          email: enrollment.student.user.email,
        },
        enrollmentStatus: enrollment.status,
        // Submission completion is based on any submitted work; published
        // grade averages deliberately use only result-published evidence.
        submittedAssessmentCount: submittedByStudent.get(enrollment.studentId) ?? 0,
        submissionCompletionPct:
          allAssessments > 0 ? Math.round(((submittedByStudent.get(enrollment.studentId) ?? 0) / allAssessments) * 1000) / 10 : null,
        gradedAssessmentCount: gradeTotals?.assessmentsCount ?? 0,
        totalAssessmentCount: allAssessments,
        publishedAveragePct: pct,
        pendingGradingCount: pendingByStudent.get(enrollment.studentId) ?? 0,
        unpublishedGradedCount: unpublishedByStudent.get(enrollment.studentId) ?? 0,
        submittedCount: submittedByStudent.get(enrollment.studentId) ?? 0,
      };
    });

    // CLO mastery per student comes from the score snapshot stored with the
    // latest run. Older runs without individual snapshots intentionally remain
    // null rather than being reconstructed from newer marks.
    const cloMastery = latestRun
      ? roster.map((entry) => ({
          studentId: entry.student.id,
          outcomes: latestRun.cloResults.map((result) => {
            const evidence = result.evidenceJson as { studentScores?: Array<{ studentId: string; score: number; mastered: boolean }> } | null;
            const score = evidence?.studentScores?.find((candidate) => candidate.studentId === entry.student.id);
            return {
              cloCode: result.clo.code,
              description: result.clo.description,
              status: score ? (score.mastered ? 'MET' : 'NOT_MET') : 'INSUFFICIENT_DATA',
              cohortStatus: result.status,
              cohortAttainmentPct: Number(result.attainmentPct),
              masteryThreshold: Number(result.clo.masteryThreshold),
              studentScore: score?.score ?? null,
            };
          }),
        }))
      : [];

    return sendData(res, {
      offering: {
        id: offering.id,
        course: { code: offering.course.code, title: offering.course.title },
        semester: offering.semester.name,
        reportingPeriod: offering.reportingPeriod ?? null,
      },
      latestRun: latestRun
        ? {
            id: latestRun.id,
            computedAt: latestRun.computedAt,
            isFrozen: latestRun.isFrozen,
            policyVersion: latestRun.policyVersion,
            engineVersion: latestRun.engineVersion,
            reportingPeriod: latestRun.reportingPeriod,
          }
        : null,
      students: roster,
      cloMastery,
    });
  })
);

/* ----------------------------- Enrolments ----------------------------- */
router.get(
  '/offerings/:id/enrollments',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const offering = await getManagedOffering(req.user!, String(req.params.id));
    const rows = await prisma.enrollment.findMany({
      where: { offeringId: offering.id },
      include: {
        student: {
          include: {
            user: { select: { id: true, name: true, email: true, isActive: true } },
            program: { select: { id: true, code: true, name: true } },
          },
        },
      },
      orderBy: { student: { rollNo: 'asc' } },
    });
    return sendData(res, rows);
  })
);

router.post(
  '/offerings/:id/enrollments',
  adminOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(z.object({ studentIds: z.array(z.string().uuid()).min(1).max(500) })),
  asyncHandler(async (req, res) => {
    const offering = await prisma.courseOffering.findUnique({
      where: { id: String(req.params.id) },
      include: { course: true, semester: true },
    });
    if (!offering) throw notFound('Course offering');
    if (offering.status === 'ARCHIVED') throw conflict('Cannot enrol students in an archived offering');

    const students = await prisma.studentProfile.findMany({
      where: { id: { in: req.body.studentIds }, isActive: true, user: { isActive: true } },
      include: { user: { select: { id: true, name: true, isActive: true } } },
    });
    if (students.length !== new Set(req.body.studentIds).size) {
      throw badRequest('One or more students do not exist or are inactive');
    }

    await prisma.$transaction(
      students.map((student) =>
        prisma.enrollment.upsert({
          where: { studentId_offeringId: { studentId: student.id, offeringId: offering.id } },
          create: { studentId: student.id, offeringId: offering.id },
          update: { status: 'ENROLLED' },
        })
      )
    );
    await audit(req, {
      action: 'INSERT',
      entityType: 'Enrollment',
      entityId: offering.id,
      metadata: { offeringId: offering.id, studentIds: students.map((student) => student.id), count: students.length },
    });
    await notify({
      userIds: students.map((student) => student.user.id),
      type: 'ENROLLMENT_CHANGED',
      title: 'Enrolled in a course',
      body: `You are enrolled in ${offering.course.code} — ${offering.course.title} for ${offering.semester.name}.`,
      link: `/offerings/${offering.id}`,
    });
    return sendData(res, { enrolled: students.length });
  })
);

router.patch(
  '/enrollments/:id',
  adminOnly,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(z.object({ status: z.enum(['ENROLLED', 'DROPPED', 'WITHDRAWN', 'COMPLETED']) })),
  asyncHandler(async (req, res) => {
    const existing = await prisma.enrollment.findUnique({
      where: { id: String(req.params.id) },
      include: { student: { include: { user: true } }, offering: { include: { course: true } } },
    });
    if (!existing) throw notFound('Enrollment');
    const row = await prisma.enrollment.update({
      where: { id: String(req.params.id) },
      data: { status: req.body.status },
    });
    await audit(req, {
      action: 'UPDATE',
      entityType: 'Enrollment',
      entityId: row.id,
      metadata: { from: existing.status, to: row.status },
    });
    await notify({
      userIds: [existing.student.userId],
      type: 'ENROLLMENT_CHANGED',
      title: 'Enrolment status updated',
      body: `Your enrolment in ${existing.offering.course.code} is now ${row.status.toLowerCase()}.`,
      link: `/offerings/${existing.offeringId}`,
    });
    return sendData(res, row);
  })
);

export default router;
