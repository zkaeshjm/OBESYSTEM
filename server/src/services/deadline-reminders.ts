import { prisma } from '../lib/prisma.js';

/**
 * Idempotent deadline reminders for assessments due in the next 48 hours.
 * A unique dedupeKey means running the job repeatedly cannot spam recipients.
 * Only assessments that were actually published are considered.
 */
export async function runDeadlineReminders(tutorId?: string) {
  const now = new Date();
  const horizon = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const assessments = await prisma.assessment.findMany({
    where: {
      status: 'PUBLISHED',
      dueAt: { gt: now, lte: horizon },
      ...(tutorId ? { offering: { tutorId } } : {}),
    },
    include: {
      offering: {
        include: {
          course: { select: { code: true, title: true } },
          semester: { select: { name: true } },
          enrollments: {
            where: { status: 'ENROLLED' },
            include: { student: { select: { userId: true } } },
          },
        },
      },
      submissions: { select: { studentId: true } },
    },
  });

  let created = 0;
  for (const assessment of assessments) {
    const submitted = new Set(assessment.submissions.map((submission) => submission.studentId));
    const pending = assessment.offering.enrollments.filter((enrollment) => !submitted.has(enrollment.studentId));
    if (pending.length === 0) continue;

    const rows = await prisma.notification.createManyAndReturn({
      data: pending.map((enrollment) => ({
        userId: enrollment.student.userId,
        type: 'DEADLINE_APPROACHING' as const,
        title: 'Assessment deadline approaching',
        body: `${assessment.title} (${assessment.offering.course.code}) is due ${assessment.dueAt!.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
        link: `/assessments/${assessment.id}`,
        dedupeKey: `deadline:${assessment.id}:${enrollment.student.userId}`,
      })),
      select: { id: true },
      skipDuplicates: true,
    });
    if (rows.length > 0) {
      await prisma.notification.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: { deliveryStatus: 'DELIVERED', deliveredAt: new Date() },
      });
      created += rows.length;
    }
  }

  return { assessmentsScanned: assessments.length, notificationsCreated: created, windowHours: 48 };
}
