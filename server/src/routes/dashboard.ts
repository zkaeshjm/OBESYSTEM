import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/async-handler.js';
import { authenticate } from '../middleware/auth.js';
import { sendData } from '../lib/http.js';
import { getStudentProfileId } from '../lib/authorization.js';

const router = Router();
router.use(authenticate);

function countStatuses(rows: Array<{ status: string }>) {
  return {
    met: rows.filter((row) => row.status === 'MET').length,
    atRisk: rows.filter((row) => row.status === 'AT_RISK').length,
    notMet: rows.filter((row) => row.status === 'NOT_MET').length,
    insufficientData: rows.filter((row) => row.status === 'INSUFFICIENT_DATA').length,
    total: rows.length,
  };
}

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const unread = await prisma.notification.count({ where: { userId: req.user!.id, readAt: null } });
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    if (req.user!.role === 'ADMIN') {
      const [
        usersByRole,
        programCount,
        courseCount,
        offeringCount,
        studentCount,
        plansOpen,
        runs,
        recentAudit,
        offerings,
      ] = await Promise.all([
        prisma.user.groupBy({ by: ['role'], where: { isActive: true }, _count: { _all: true } }),
        prisma.program.count({ where: { isActive: true } }),
        prisma.course.count({ where: { isActive: true } }),
        prisma.courseOffering.count({ where: { status: { not: 'ARCHIVED' } } }),
        prisma.studentProfile.count({ where: { isActive: true } }),
        prisma.improvementActionPlan.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
        prisma.attainmentRun.findMany({
          include: {
            offering: { include: { course: { select: { code: true, title: true } }, semester: { select: { name: true } } } },
            cloResults: { select: { status: true, cloId: true, attainmentPct: true, targetPct: true, clo: { select: { code: true } } } },
            ploResults: { select: { status: true, ploId: true, attainmentPct: true, plo: { select: { code: true } } } },
          },
          orderBy: { computedAt: 'desc' },
          take: 100,
        }),
        prisma.auditLog.findMany({ orderBy: { occurredAt: 'desc' }, take: 8, include: { actor: { select: { name: true } } } }),
        prisma.courseOffering.findMany({
          where: { status: { not: 'ARCHIVED' } },
          include: {
            course: { select: { code: true, title: true, program: { select: { code: true } } } },
            semester: { select: { name: true } },
            tutor: { select: { name: true } },
            _count: { select: { enrollments: true, assessments: true } },
            attainmentRuns: { orderBy: { computedAt: 'desc' }, take: 1, select: { id: true, computedAt: true, isFrozen: true } },
          },
          orderBy: [{ semester: { startDate: 'desc' } }, { course: { code: 'asc' } }],
          take: 12,
        }),
      ]);

      const latestByOffering = new Map<string, (typeof runs)[number]>();
      for (const run of runs) if (!latestByOffering.has(run.offeringId)) latestByOffering.set(run.offeringId, run);
      const latestRuns = [...latestByOffering.values()];
      const cloStatuses = countStatuses(latestRuns.flatMap((run) => run.cloResults));

      return sendData(res, {
        role: 'ADMIN',
        cards: [
          { key: 'students', label: 'Active students', value: studentCount, detail: `${usersByRole.find((row) => row.role === 'TUTOR')?._count._all ?? 0} tutors` },
          { key: 'programs', label: 'Programmes', value: programCount, detail: `${courseCount} active courses` },
          { key: 'offerings', label: 'Course offerings', value: offeringCount, detail: 'Current and historical' },
          { key: 'attainment', label: 'Calculated offerings', value: latestRuns.length, detail: `${cloStatuses.notMet} CLO gaps` },
          { key: 'plans', label: 'Open improvement plans', value: plansOpen, detail: 'Across all offerings' },
          { key: 'unread', label: 'Unread notifications', value: unread, detail: 'Your inbox' },
        ],
        cloStatuses,
        offerings,
        recentRuns: latestRuns.slice(0, 6).map((run) => ({
          id: run.id,
          offeringId: run.offeringId,
          isFrozen: run.isFrozen,
          computedAt: run.computedAt,
          course: run.offering.course,
          semester: run.offering.semester,
          statuses: countStatuses(run.cloResults),
        })),
        recentAudit,
        notifications,
        usersByRole,
      });
    }

    if (req.user!.role === 'TUTOR') {
      const [offerings, pendingGrading, upcoming, plans, runs] = await Promise.all([
        prisma.courseOffering.findMany({
          where: { tutorId: req.user!.id, status: { not: 'ARCHIVED' } },
          include: {
            course: { select: { code: true, title: true, program: { select: { code: true } } } },
            semester: { select: { name: true, isActive: true } },
            _count: { select: { enrollments: true, assessments: true } },
            attainmentRuns: { orderBy: { computedAt: 'desc' }, take: 1, select: { id: true, computedAt: true, isFrozen: true } },
          },
          orderBy: [{ semester: { startDate: 'desc' } }, { course: { code: 'asc' } }],
        }),
        prisma.submission.findMany({
          where: {
            status: { in: ['SUBMITTED', 'LATE'] },
            assessment: { offering: { tutorId: req.user!.id } },
          },
          include: {
            student: { include: { user: { select: { name: true } } } },
            assessment: { select: { id: true, title: true, offering: { select: { course: { select: { code: true } } } } } },
          },
          orderBy: { submittedAt: 'asc' },
          take: 10,
        }),
        prisma.assessment.findMany({
          where: {
            status: 'PUBLISHED',
            dueAt: { gte: new Date() },
            offering: { tutorId: req.user!.id },
          },
          include: {
            offering: { select: { id: true, course: { select: { code: true } } } },
            _count: { select: { submissions: true } },
          },
          orderBy: { dueAt: 'asc' },
          take: 6,
        }),
        prisma.improvementActionPlan.findMany({
          where: { offering: { tutorId: req.user!.id }, status: { in: ['OPEN', 'IN_PROGRESS'] } },
          include: { offering: { select: { course: { select: { code: true } } } }, clo: { select: { code: true } } },
          orderBy: { createdAt: 'desc' },
          take: 6,
        }),
        prisma.attainmentRun.findMany({
          where: { offering: { tutorId: req.user!.id } },
          include: {
            cloResults: {
              include: { clo: { select: { code: true, description: true } } },
            },
            ploResults: { select: { status: true } },
            offering: { select: { course: { select: { code: true } } } },
          },
          orderBy: { computedAt: 'desc' },
          take: 50,
        }),
      ]);

      const latestByOffering = new Map<string, (typeof runs)[number]>();
      for (const run of runs) if (!latestByOffering.has(run.offeringId)) latestByOffering.set(run.offeringId, run);
      const latestRuns = [...latestByOffering.values()];
      const cloStatuses = countStatuses(latestRuns.flatMap((run) => run.cloResults));
      const gaps = latestRuns.flatMap((run) =>
        run.cloResults
          .filter((result) => result.status === 'NOT_MET' || result.status === 'AT_RISK')
          .map((result) => ({
            cloCode: result.clo.code,
            description: result.clo.description,
            course: run.offering.course.code,
            attainmentPct: Number(result.attainmentPct),
            targetPct: Number(result.targetPct),
            status: result.status,
          }))
      );
      const studentIds = await prisma.enrollment.findMany({
        where: { offering: { tutorId: req.user!.id }, status: 'ENROLLED' },
        distinct: ['studentId'],
        select: { studentId: true },
      });

      return sendData(res, {
        role: 'TUTOR',
        cards: [
          { key: 'offerings', label: 'Assigned offerings', value: offerings.length, detail: 'Active and completed' },
          { key: 'students', label: 'Enrolled students', value: studentIds.length, detail: 'Distinct across offerings' },
          { key: 'pending', label: 'Submissions to grade', value: pendingGrading.length, detail: 'Oldest shown first' },
          { key: 'attainment', label: 'Calculated offerings', value: latestRuns.length, detail: `${cloStatuses.notMet} CLO gaps` },
          { key: 'plans', label: 'Open improvement plans', value: plans.length, detail: 'Assigned to your courses' },
          { key: 'unread', label: 'Unread notifications', value: unread, detail: 'Your inbox' },
        ],
        offerings,
        pendingGrading,
        upcoming,
        plans,
        gaps: gaps.slice(0, 8),
        cloStatuses,
        notifications,
      });
    }

    // Student
    const profileId = await getStudentProfileId(req.user!.id);
    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: profileId, status: { in: ['ENROLLED', 'COMPLETED'] } },
      include: {
        offering: {
          include: {
            course: { select: { code: true, title: true } },
            semester: { select: { name: true } },
            tutor: { select: { name: true } },
            attainmentRuns: {
              orderBy: { computedAt: 'desc' },
              take: 1,
              include: {
                cloResults: {
                  include: { clo: { select: { code: true, description: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: { enrolledAt: 'desc' },
    });

    const offeringIds = enrollments.map((enrollment) => enrollment.offeringId);
    const [upcoming, publishedResults] = await Promise.all([
      prisma.assessment.findMany({
        where: {
          offeringId: { in: offeringIds },
          status: 'PUBLISHED',
          OR: [{ dueAt: null }, { dueAt: { gte: new Date() } }],
        },
        include: {
          offering: { select: { id: true, course: { select: { code: true, title: true } } } },
          submissions: { where: { studentId: profileId }, select: { id: true, status: true, submittedAt: true } },
        },
        orderBy: { dueAt: 'asc' },
        take: 8,
      }),
      prisma.assessment.findMany({
        where: {
          offeringId: { in: offeringIds },
          resultsPublishedAt: { not: null },
        },
        include: {
          offering: { select: { course: { select: { code: true } } } },
          submissions: {
            where: { studentId: profileId },
            select: {
              id: true,
              status: true,
              overallFeedback: true,
              grades: { select: { marks: true, item: { select: { maxMarks: true, label: true } } } },
            },
          },
        },
        orderBy: { resultsPublishedAt: 'desc' },
        take: 8,
      }),
    ]);

    const cloScores = enrollments.flatMap((enrollment) => {
      const run = enrollment.offering.attainmentRuns[0];
      if (!run) return [];
      return run.cloResults.map((result) => ({
        offeringId: enrollment.offeringId,
        course: enrollment.offering.course.code,
        cloCode: result.clo.code,
        description: result.clo.description,
        cohortAttainmentPct: Number(result.attainmentPct),
        cohortStatus: result.status,
      }));
    });

    return sendData(res, {
      role: 'STUDENT',
      cards: [
        { key: 'courses', label: 'Enrolled courses', value: enrollments.length, detail: 'Current and completed' },
        { key: 'upcoming', label: 'Open assessments', value: upcoming.filter((assessment) => assessment.submissions.length === 0).length, detail: 'Not yet submitted' },
        { key: 'results', label: 'Published results', value: publishedResults.length, detail: 'With tutor feedback' },
        { key: 'outcomes', label: 'Tracked CLOs', value: cloScores.length, detail: 'Across calculated courses' },
        { key: 'unread', label: 'Unread notifications', value: unread, detail: 'Your inbox' },
      ],
      enrollments,
      upcoming,
      publishedResults,
      cloScores,
      notifications,
    });
  })
);

export default router;
