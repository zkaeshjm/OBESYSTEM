import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { createAssessmentWithItems, createScenario, resetDb } from './helpers.js';

describe('database integrity constraints', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('refuses to assign an offering to a non-tutor account', async () => {
    const scenario = await createScenario();
    await expect(
      prisma.courseOffering.create({
        data: {
          courseId: scenario.course.id,
          semesterId: scenario.semester.id,
          tutorId: scenario.admin.id,
          sectionName: 'INVALID',
        },
      })
    ).rejects.toThrow();
  });

  it('refuses a grade above the item maximum', async () => {
    const scenario = await createScenario();
    const assessment = await createAssessmentWithItems(scenario.offering.id, scenario.tutor.id, scenario.clo.id, { publish: true });
    const submission = await prisma.submission.create({
      data: { assessmentId: assessment.id, studentId: scenario.students[0].studentProfile!.id, content: 'x' },
    });
    await expect(
      prisma.submissionItemGrade.create({
        data: {
          submissionId: submission.id,
          itemId: assessment.items[0].id,
          marks: Number(assessment.items[0].maxMarks) + 1,
          state: 'GRADED',
          gradedById: scenario.tutor.id,
        },
      })
    ).rejects.toThrow();
  });

  it('refuses negative marks', async () => {
    const scenario = await createScenario();
    const assessment = await createAssessmentWithItems(scenario.offering.id, scenario.tutor.id, scenario.clo.id, { publish: true });
    const submission = await prisma.submission.create({
      data: { assessmentId: assessment.id, studentId: scenario.students[0].studentProfile!.id, content: 'x' },
    });
    await expect(
      prisma.submissionItemGrade.create({
        data: {
          submissionId: submission.id,
          itemId: assessment.items[0].id,
          marks: -1,
          state: 'GRADED',
          gradedById: scenario.tutor.id,
        },
      })
    ).rejects.toThrow();
  });

  it('refuses evidence mapping an item to another course CLO', async () => {
    const scenario = await createScenario();
    const assessment = await createAssessmentWithItems(scenario.offering.id, scenario.tutor.id, scenario.clo.id);
    await expect(
      prisma.assessmentItemClo.create({
        data: { itemId: assessment.items[0].id, cloId: scenario.otherClo.id, weight: 1 },
      })
    ).rejects.toThrow();
  });

  it('refuses a rubric criterion mark above its maximum', async () => {
    const scenario = await createScenario();
    const assessment = await prisma.assessment.create({
      data: {
        offeringId: scenario.offering.id,
        title: 'Rubric constraint',
        type: 'PROJECT',
        maxMarks: 20,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        createdById: scenario.tutor.id,
        items: {
          create: [
            {
              label: 'Report',
              maxMarks: 20,
              position: 0,
              cloMappings: { create: [{ cloId: scenario.clo.id, weight: 1 }] },
              rubricCriteria: { create: [{ label: 'Evidence', maxMarks: 8, position: 0 }] },
            },
          ],
        },
      },
      include: { items: { include: { rubricCriteria: true } } },
    });
    const submission = await prisma.submission.create({
      data: { assessmentId: assessment.id, studentId: scenario.students[0].studentProfile!.id, content: 'x' },
    });
    await expect(
      prisma.submissionCriterionGrade.create({
        data: { submissionId: submission.id, criterionId: assessment.items[0].rubricCriteria[0].id, marks: 9 },
      })
    ).rejects.toThrow();
  });

  it('refuses a submission from a student not enrolled in the offering', async () => {
    const scenario = await createScenario();
    const assessment = await createAssessmentWithItems(scenario.offering.id, scenario.tutor.id, scenario.clo.id, { publish: true });
    await expect(
      prisma.submission.create({
        data: { assessmentId: assessment.id, studentId: scenario.outsideStudent.studentProfile!.id, content: 'x' },
      })
    ).rejects.toThrow();
  });

  it('prevents duplicate enrolments', async () => {
    const scenario = await createScenario();
    await expect(
      prisma.enrollment.create({
        data: { studentId: scenario.students[0].studentProfile!.id, offeringId: scenario.offering.id },
      })
    ).rejects.toThrow();
  });

  it('allows only one active academic session', async () => {
    await createScenario();
    await expect(
      prisma.semester.create({
        data: { name: 'Fall 2026', startDate: new Date('2026-08-01'), endDate: new Date('2026-12-31'), isActive: true },
      })
    ).rejects.toThrow();
  });

  it('allows only one active attainment policy', async () => {
    const scenario = await createScenario();
    await expect(
      prisma.attainmentPolicy.create({
        data: {
          name: 'Second active policy',
          version: 'other',
          config: scenario.policy.config as never,
          isActive: true,
          createdById: scenario.admin.id,
        },
      })
    ).rejects.toThrow();
  });

  it('requires a delivered timestamp for a delivered notification', async () => {
    const scenario = await createScenario();
    await expect(
      prisma.notification.create({
        data: {
          userId: scenario.students[0].id,
          type: 'SYSTEM',
          title: 'Invalid delivery',
          body: 'Missing timestamp',
          deliveryStatus: 'DELIVERED',
        },
      })
    ).rejects.toThrow();
  });
});
