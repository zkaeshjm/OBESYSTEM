import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/password.js';
import { signAccessToken } from '../src/lib/tokens.js';
import type { Role } from '@prisma/client';

let passwordHashPromise: Promise<string> | null = null;
export const TEST_PASSWORD = 'TestPass123!';

export function testPasswordHash() {
  passwordHashPromise ??= hashPassword(TEST_PASSWORD);
  return passwordHashPromise;
}

export async function resetDb() {
  // Child rows first; the test database is disposable but we still respect FKs.
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.improvementActionPlan.deleteMany(),
    prisma.ploAttainment.deleteMany(),
    prisma.cloAttainment.deleteMany(),
    prisma.attainmentRun.deleteMany(),
    prisma.attainmentPolicy.deleteMany(),
    prisma.gradeChange.deleteMany(),
    prisma.submissionItemGrade.deleteMany(),
    prisma.submission.deleteMany(),
    prisma.assessmentItemClo.deleteMany(),
    prisma.assessmentItem.deleteMany(),
    prisma.assessment.deleteMany(),
    prisma.enrollment.deleteMany(),
    prisma.courseOffering.deleteMany(),
    prisma.cloPloMapping.deleteMany(),
    prisma.clo.deleteMany(),
    prisma.plo.deleteMany(),
    prisma.course.deleteMany(),
    prisma.studentProfile.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.user.deleteMany(),
    prisma.semester.deleteMany(),
    prisma.program.deleteMany(),
    prisma.department.deleteMany(),
  ]);
}

export function tokenFor(user: { id: string; role: Role; email: string }) {
  return signAccessToken({ sub: user.id, role: user.role, email: user.email });
}

export async function createUser(input: {
  email: string;
  name: string;
  role: Role;
  departmentId?: string;
  programId?: string;
  rollNo?: string;
}) {
  const passwordHash = await testPasswordHash();
  return prisma.user.create({
    data: {
      email: input.email.toLowerCase(),
      name: input.name,
      role: input.role,
      passwordHash,
      departmentId: input.departmentId,
      ...(input.role === 'STUDENT'
        ? {
            studentProfile: {
              create: {
                rollNo: input.rollNo ?? `ROLL-${Math.random().toString(36).slice(2, 9)}`,
                programId: input.programId!,
                batch: '2026',
              },
            },
          }
        : {}),
    },
    include: { studentProfile: true },
  });
}

export async function createScenario() {
  const passwordHash = await testPasswordHash();
  const department = await prisma.department.create({
    data: { name: 'Test Institute', code: 'TI' },
  });
  const [program, otherProgram] = await Promise.all([
    prisma.program.create({ data: { departmentId: department.id, name: 'BS Computer Science', code: 'BSCS', creditHours: 130 } }),
    prisma.program.create({ data: { departmentId: department.id, name: 'BS Software Engineering', code: 'BSSE', creditHours: 130 } }),
  ]);
  const semester = await prisma.semester.create({
    data: { name: 'Spring 2026', startDate: new Date('2026-02-01'), endDate: new Date('2026-06-30'), isActive: true },
  });
  const [course, otherCourse] = await Promise.all([
    prisma.course.create({ data: { programId: program.id, code: 'CS-101', title: 'Intro to Computing', creditHours: 3 } }),
    prisma.course.create({ data: { programId: otherProgram.id, code: 'SE-101', title: 'Software Foundations', creditHours: 3 } }),
  ]);

  const admin = await prisma.user.create({
    data: { email: 'admin@test.local', name: 'Test Admin', role: 'ADMIN', departmentId: department.id, passwordHash },
  });
  const tutor = await prisma.user.create({
    data: { email: 'tutor@test.local', name: 'Test Tutor', role: 'TUTOR', departmentId: department.id, passwordHash },
  });
  const otherTutor = await prisma.user.create({
    data: { email: 'other.tutor@test.local', name: 'Other Tutor', role: 'TUTOR', departmentId: department.id, passwordHash },
  });

  const offering = await prisma.courseOffering.create({
    data: { courseId: course.id, semesterId: semester.id, tutorId: tutor.id, sectionName: 'A', status: 'ACTIVE', reportingPeriod: 'Spring 2026' },
  });
  const otherOffering = await prisma.courseOffering.create({
    data: { courseId: otherCourse.id, semesterId: semester.id, tutorId: otherTutor.id, sectionName: 'B', status: 'ACTIVE' },
  });

  const students = [];
  for (let index = 0; index < 5; index += 1) {
    const student = await createUser({
      email: `student${index}@test.local`,
      name: `Student ${index + 1}`,
      role: 'STUDENT',
      departmentId: department.id,
      programId: program.id,
      rollNo: `BSCS-00${index + 1}`,
    });
    await prisma.enrollment.create({ data: { studentId: student.studentProfile!.id, offeringId: offering.id } });
    students.push(student);
  }
  const outsideStudent = await createUser({
    email: 'outside@test.local',
    name: 'Outside Student',
    role: 'STUDENT',
    departmentId: department.id,
    programId: otherProgram.id,
    rollNo: 'BSSE-001',
  });
  await prisma.enrollment.create({ data: { studentId: outsideStudent.studentProfile!.id, offeringId: otherOffering.id } });

  const plo = await prisma.plo.create({
    data: { programId: program.id, code: 'PLO-1', description: 'Apply computing knowledge', bloomDomain: 'COGNITIVE', targetAttainment: 60 },
  });
  const otherPlo = await prisma.plo.create({
    data: { programId: otherProgram.id, code: 'PLO-1', description: 'Apply software engineering knowledge', bloomDomain: 'COGNITIVE', targetAttainment: 60 },
  });

  const clo = await prisma.clo.create({
    data: {
      courseId: course.id,
      code: 'CLO-1',
      description: 'Analyze a computing problem and apply an algorithmic solution',
      bloomLevel: 'ANALYZE',
      masteryThreshold: 60,
      approvalStatus: 'APPROVED',
      createdById: tutor.id,
      approvedById: admin.id,
      approvedAt: new Date(),
      ploMappings: { create: [{ ploId: plo.id, weight: 3 }] },
    },
  });
  const otherClo = await prisma.clo.create({
    data: {
      courseId: otherCourse.id,
      code: 'CLO-1',
      description: 'Analyze software architecture requirements and constraints',
      bloomLevel: 'ANALYZE',
      masteryThreshold: 60,
      approvalStatus: 'APPROVED',
      createdById: otherTutor.id,
      approvedById: admin.id,
      approvedAt: new Date(),
      ploMappings: { create: [{ ploId: otherPlo.id, weight: 3 }] },
    },
  });

  const policy = await prisma.attainmentPolicy.create({
    data: {
      name: 'Test policy',
      version: 'test-1',
      config: {
        cloMasteryThreshold: 50,
        cohortAttainmentTarget: 65,
        minCohortSize: 5,
        atRiskBand: 5,
        rounding: 1,
        missingEvidence: 'exclude',
        includeUnapprovedClos: false,
        ploAggregation: 'weighted',
        ploWeighting: 'mapping_weight_and_cohort',
      },
      isActive: true,
      createdById: admin.id,
    },
  });

  return {
    department,
    program,
    otherProgram,
    semester,
    course,
    otherCourse,
    admin,
    tutor,
    otherTutor,
    students,
    outsideStudent,
    offering,
    otherOffering,
    plo,
    otherPlo,
    clo,
    otherClo,
    policy,
  };
}

export async function createAssessmentWithItems(
  offeringId: string,
  createdById: string,
  cloId: string,
  options: { publish?: boolean; dueAt?: Date | null } = {}
) {
  return prisma.assessment.create({
    data: {
      offeringId,
      title: 'Test assessment',
      type: 'ASSIGNMENT',
      maxMarks: 40,
      dueAt: options.dueAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: options.publish ? 'PUBLISHED' : 'DRAFT',
      publishedAt: options.publish ? new Date() : null,
      createdById,
      items: {
        create: [
          {
            label: 'Item 1',
            prompt: 'Explain the solution',
            maxMarks: 20,
            position: 0,
            cloMappings: { create: [{ cloId, weight: 1 }] },
          },
          {
            label: 'Item 2',
            prompt: 'Apply the solution',
            maxMarks: 20,
            position: 1,
            cloMappings: { create: [{ cloId, weight: 2 }] },
          },
        ],
      },
    },
    include: { items: { orderBy: { position: 'asc' } } },
  });
}

export async function submitAndGrade(
  assessmentId: string,
  studentId: string,
  gradedById: string,
  marks: Array<[number, number]>
) {
  const assessment = await prisma.assessment.findUniqueOrThrow({
    where: { id: assessmentId },
    include: { items: { orderBy: { position: 'asc' } } },
  });
  const submission = await prisma.submission.create({
    data: {
      assessmentId,
      studentId,
      content: 'Test submission',
      status: 'GRADED',
      gradedAt: new Date(),
      overallFeedback: 'Test feedback',
    },
  });
  await prisma.submissionItemGrade.createMany({
    data: assessment.items.map((item, index) => ({
      submissionId: submission.id,
      itemId: item.id,
      marks: marks[index] * Number(item.maxMarks),
      state: 'GRADED' as const,
      gradedById,
      feedback: 'Test item feedback',
    })),
  });
  return submission;
}
