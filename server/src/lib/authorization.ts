import type { CourseOffering, Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { forbidden, notFound } from '../lib/errors.js';

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export async function getStudentProfileId(userId: string): Promise<string> {
  const profile = await prisma.studentProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!profile) throw forbidden('No student profile is linked to this account');
  return profile.id;
}

export async function getOfferingForViewer(user: CurrentUser, offeringId: string) {
  const offering = await prisma.courseOffering.findUnique({
    where: { id: offeringId },
    include: {
      course: { select: { id: true, code: true, title: true, programId: true, program: { select: { id: true, code: true, name: true } } } },
      semester: true,
      tutor: { select: { id: true, name: true, email: true } },
    },
  });
  if (!offering) throw notFound('Course offering');

  if (user.role === 'ADMIN') return offering;
  if (user.role === 'TUTOR') {
    if (offering.tutorId !== user.id) throw forbidden('You are not assigned to this course offering');
    return offering;
  }

  const profileId = await getStudentProfileId(user.id);
  const enrollment = await prisma.enrollment.findUnique({
    where: { studentId_offeringId: { studentId: profileId, offeringId } },
    select: { status: true },
  });
  if (!enrollment || !['ENROLLED', 'COMPLETED'].includes(enrollment.status)) {
    throw forbidden('You are not enrolled in this course offering');
  }
  return offering;
}

export async function getManagedOffering(user: CurrentUser, offeringId: string) {
  const offering = await prisma.courseOffering.findUnique({ where: { id: offeringId } });
  if (!offering) throw notFound('Course offering');
  if (user.role === 'ADMIN') return offering;
  if (user.role === 'TUTOR' && offering.tutorId === user.id) return offering;
  throw forbidden('Only the assigned tutor or an administrator may manage this offering');
}

export async function assertCourseAuthor(user: CurrentUser, courseId: string) {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw notFound('Course');
  if (user.role === 'ADMIN') return course;
  if (user.role === 'TUTOR') {
    const assignment = await prisma.courseOffering.findFirst({
      where: { courseId, tutorId: user.id },
      select: { id: true },
    });
    if (assignment) return course;
  }
  throw forbidden('You are not authorized to author outcomes for this course');
}

export type OfferingWithRelations = Prisma.CourseOfferingGetPayload<{
  include: {
    course: { select: { id: true; code: true; title: true; programId: true; program: { select: { id: true; code: true; name: true } } } };
    semester: true;
    tutor: { select: { id: true; name: true; email: true } };
  };
}>;

export function isOfferingManager(
  user: CurrentUser,
  offering: Pick<CourseOffering, 'tutorId'>
): boolean {
  return user.role === 'ADMIN' || (user.role === 'TUTOR' && offering.tutorId === user.id);
}

export async function assertAssessmentManager(user: CurrentUser, assessmentId: string) {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    include: { offering: { select: { id: true, tutorId: true, courseId: true } } },
  });
  if (!assessment) throw notFound('Assessment');
  if (user.role === 'ADMIN') return assessment;
  if (user.role === 'TUTOR' && assessment.offering.tutorId === user.id) return assessment;
  throw forbidden('Only the assigned tutor or an administrator may manage this assessment');
}

export async function assertAssessmentViewer(user: CurrentUser, assessmentId: string) {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    include: { offering: { select: { id: true, tutorId: true, courseId: true } } },
  });
  if (!assessment) throw notFound('Assessment');

  if (user.role === 'ADMIN') return assessment;
  if (user.role === 'TUTOR') {
    if (assessment.offering.tutorId !== user.id) throw forbidden();
    return assessment;
  }

  const profileId = await getStudentProfileId(user.id);
  const enrollment = await prisma.enrollment.findUnique({
    where: { studentId_offeringId: { studentId: profileId, offeringId: assessment.offering.id } },
    select: { status: true },
  });
  if (!enrollment || !['ENROLLED', 'COMPLETED'].includes(enrollment.status)) {
    throw forbidden('You are not enrolled in this assessment');
  }
  if (assessment.status === 'DRAFT') throw forbidden('This assessment has not been published');
  return assessment;
}

export async function getSubmissionForViewer(user: CurrentUser, submissionId: string) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      assessment: {
        include: {
          items: {
            orderBy: { position: 'asc' },
            include: { cloMappings: { include: { clo: true } }, rubricCriteria: { orderBy: { position: 'asc' } } },
          },
          offering: { select: { id: true, tutorId: true, courseId: true } },
        },
      },
      student: { include: { user: { select: { id: true, name: true, email: true } } } },
      grades: true,
      criterionGrades: true,
    },
  });
  if (!submission) throw notFound('Submission');

  if (user.role === 'ADMIN') return submission;
  if (user.role === 'TUTOR') {
    if (submission.assessment.offering.tutorId !== user.id) throw forbidden();
    return submission;
  }
  const profileId = await getStudentProfileId(user.id);
  if (submission.studentId !== profileId) throw forbidden('You may only view your own submission');
  return submission;
}
