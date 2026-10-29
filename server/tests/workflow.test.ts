import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { createScenario, resetDb, tokenFor } from './helpers.js';

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('OBE vertical workflow', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('runs CLO approval, assessment, grading, attainment, freezing and reporting end to end', async () => {
    const scenario = await createScenario();
    const adminToken = tokenFor(scenario.admin);
    const tutorToken = tokenFor(scenario.tutor);
    const studentToken = tokenFor(scenario.students[0]);

    // 1. Tutor authors a CLO → pending approval, invisible to students.
    const cloResponse = await request(app)
      .post('/api/v1/clos')
      .set(auth(tutorToken))
      .send({
        courseId: scenario.course.id,
        code: 'CLO-2',
        description: 'Design a tested solution to a computing problem using appropriate abstractions',
        bloomLevel: 'CREATE',
        masteryThreshold: 60,
        ploMappings: [{ ploId: scenario.plo.id, weight: 2 }],
      });
    expect(cloResponse.status).toBe(201);
    expect(cloResponse.body.data.approvalStatus).toBe('PENDING');

    const studentClos = await request(app).get('/api/v1/clos').set(auth(studentToken));
    expect(studentClos.body.data.map((clo: { code: string }) => clo.code)).toEqual(['CLO-1']);

    const approve = await request(app).post(`/api/v1/clos/${cloResponse.body.data.id}/approve`).set(auth(adminToken));
    expect(approve.status).toBe(200);
    expect(approve.body.data.approvalStatus).toBe('APPROVED');

    // 2. Tutor creates and publishes an assessment with item→CLO evidence mappings.
    const assessmentResponse = await request(app)
      .post('/api/v1/assessments')
      .set(auth(tutorToken))
      .send({
        offeringId: scenario.offering.id,
        title: 'End-to-end assessment',
        type: 'ASSIGNMENT',
        instructions: 'Answer both items.',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        items: [
          { label: 'Item 1', prompt: 'Explain', maxMarks: 20, cloMappings: [{ cloId: scenario.clo.id, weight: 1 }] },
          { label: 'Item 2', prompt: 'Apply', maxMarks: 20, cloMappings: [{ cloId: scenario.clo.id, weight: 1 }] },
        ],
      });
    expect(assessmentResponse.status).toBe(201);
    const assessmentId = assessmentResponse.body.data.id;
    expect(Number(assessmentResponse.body.data.maxMarks)).toBe(40);

    const studentDraft = await request(app).get(`/api/v1/assessments/${assessmentId}`).set(auth(studentToken));
    expect(studentDraft.status).toBe(403);

    const publish = await request(app).post(`/api/v1/assessments/${assessmentId}/publish`).set(auth(tutorToken));
    expect(publish.status).toBe(200);
    expect(publish.body.data.status).toBe('PUBLISHED');

    const studentNotification = await prisma.notification.findFirst({
      where: { userId: scenario.students[0].id, type: 'ASSESSMENT_PUBLISHED' },
    });
    expect(studentNotification).not.toBeNull();

    // 3. Students submit; duplicates are rejected.
    const percentages = [90, 80, 70, 60, 50];
    for (const [index, student] of scenario.students.entries()) {
      const submit = await request(app)
        .post(`/api/v1/assessments/${assessmentId}/submissions`)
        .set(auth(tokenFor(student)))
        .send({ content: `Submission ${index + 1}` });
      expect(submit.status).toBe(201);
    }
    const duplicate = await request(app)
      .post(`/api/v1/assessments/${assessmentId}/submissions`)
      .set(auth(studentToken))
      .send({ content: 'Again' });
    expect(duplicate.status).toBe(409);

    // 4. Grading permissions, mark bounds, and grade publication rules.
    const submissions = await prisma.submission.findMany({
      where: { assessmentId },
      include: { student: true },
      orderBy: { student: { rollNo: 'asc' } },
    });
    const items = await prisma.assessmentItem.findMany({ where: { assessmentId }, orderBy: { position: 'asc' } });

    const invalidGrade = await request(app)
      .put(`/api/v1/submissions/${submissions[0].id}/grades`)
      .set(auth(tutorToken))
      .send({ grades: [{ itemId: items[0].id, marks: 25, state: 'GRADED' }] });
    expect(invalidGrade.status).toBe(400);

    const foreignGrade = await request(app)
      .put(`/api/v1/submissions/${submissions[0].id}/grades`)
      .set(auth(tokenFor(scenario.otherTutor)))
      .send({ grades: [{ itemId: items[0].id, marks: 10, state: 'GRADED' }] });
    expect(foreignGrade.status).toBe(403);

    for (const [index, submission] of submissions.entries()) {
      const marks = (percentages[index] / 100) * 20;
      const grade = await request(app)
        .put(`/api/v1/submissions/${submission.id}/grades`)
        .set(auth(tutorToken))
        .send({
          grades: [
            { itemId: items[0].id, marks, state: 'GRADED', feedback: 'Item one feedback' },
            { itemId: items[1].id, marks, state: 'GRADED', feedback: 'Item two feedback' },
          ],
          overallFeedback: 'Overall feedback',
        });
      expect(grade.status).toBe(200);
    }

    const beforePublication = await request(app).get(`/api/v1/assessments/${assessmentId}`).set(auth(studentToken));
    expect(beforePublication.status).toBe(200);
    expect(beforePublication.body.data.canViewResults).toBe(false);
    expect(beforePublication.body.data.submissions[0].grades).toHaveLength(0);

    const publishResults = await request(app).post(`/api/v1/assessments/${assessmentId}/publish-results`).set(auth(tutorToken));
    expect(publishResults.status).toBe(200);

    const afterPublication = await request(app).get(`/api/v1/assessments/${assessmentId}`).set(auth(studentToken));
    expect(afterPublication.body.data.canViewResults).toBe(true);
    expect(afterPublication.body.data.submissions[0].grades).toHaveLength(2);
    expect(afterPublication.body.data.submissions[0].overallFeedback).toBe('Overall feedback');

    // 5. Attainment calculation uses persisted evidence and stores provenance.
    const compute = await request(app)
      .post(`/api/v1/offerings/${scenario.offering.id}/attainment-runs`)
      .set(auth(tutorToken))
      .send({ reportingPeriod: 'Spring 2026' });
    expect(compute.status).toBe(201);
    expect(compute.body.data.policyVersion).toBe('test-1');
    expect(compute.body.data.engineVersion).toBe('attain-v1');

    const latest = await request(app)
      .get(`/api/v1/offerings/${scenario.offering.id}/attainment/latest`)
      .set(auth(tutorToken));
    expect(latest.status).toBe(200);
    const cloResult = latest.body.data.cloResults[0];
    expect(Number(cloResult.attainmentPct)).toBe(80);
    expect(cloResult.attainedCount).toBe(4);
    expect(cloResult.eligibleCount).toBe(5);
    expect(cloResult.status).toBe('MET');
    expect(Number(latest.body.data.ploResults[0].attainmentPct)).toBe(80);
    expect(latest.body.data.ploResults[0].status).toBe('MET');
    expect(latest.body.data.policySnapshot).toBeTruthy();

    // 6. Freezing is one-way; a second freeze is refused.
    const freeze = await request(app).post(`/api/v1/attainment-runs/${compute.body.data.id}/freeze`).set(auth(tutorToken));
    expect(freeze.status).toBe(200);
    expect(freeze.body.data.isFrozen).toBe(true);
    const refreeze = await request(app).post(`/api/v1/attainment-runs/${compute.body.data.id}/freeze`).set(auth(tutorToken));
    expect(refreeze.status).toBe(409);

    // 7. Reports use the persisted run.
    const report = await request(app)
      .get(`/api/v1/reports/attainment?offeringId=${scenario.offering.id}`)
      .set(auth(tutorToken));
    expect(report.status).toBe(200);
    expect(report.body.data.runs).toHaveLength(1);
    expect(report.body.data.runs[0].isFrozen).toBe(true);
    expect(report.body.data.cloRows[0].status).toBe('MET');
    expect(report.body.data.provenance.source).toBe('persisted_attainment_runs');

    // 8. Student progress is scoped and internal evidence metadata is not exposed.
    const progress = await request(app).get('/api/v1/students/me/progress').set(auth(studentToken));
    expect(progress.status).toBe(200);
    expect(progress.body.data.offerings).toHaveLength(1);
    const progressEntry = progress.body.data.offerings[0];
    expect(progressEntry.cloScores[0].score).toBe(90);
    expect(progressEntry.cloScores[0].mastered).toBe(true);
    expect(JSON.stringify(progressEntry.run)).not.toContain('evidenceJson');

    // 9. Audit trail records the critical actions.
    const audits = await request(app).get('/api/v1/audit-logs?limit=100').set(auth(adminToken));
    const actions = audits.body.data.map((entry: { action: string }) => entry.action);
    expect(actions).toContain('APPROVE');
    expect(actions).toContain('GRADE');
    expect(actions).toContain('COMPUTE_ATTAINMENT');
    expect(actions).toContain('FINALIZE');
  });

  it('records and enforces rubric criterion grades', async () => {
    const scenario = await createScenario();
    const tutorToken = tokenFor(scenario.tutor);
    const studentToken = tokenFor(scenario.students[0]);

    const created = await request(app)
      .post('/api/v1/assessments')
      .set(auth(tutorToken))
      .send({
        offeringId: scenario.offering.id,
        title: 'Rubric assessment',
        type: 'PROJECT',
        items: [
          {
            label: 'Report',
            maxMarks: 20,
            rubricCriteria: [
              { label: 'Evidence', maxMarks: 8 },
              { label: 'Analysis', maxMarks: 12 },
            ],
            cloMappings: [{ cloId: scenario.clo.id, weight: 1 }],
          },
        ],
      });
    expect(created.status).toBe(201);
    expect(created.body.data.items[0].rubricCriteria).toHaveLength(2);
    const assessmentId = created.body.data.id;
    const item = created.body.data.items[0];

    await request(app).post(`/api/v1/assessments/${assessmentId}/publish`).set(auth(tutorToken));
    const submit = await request(app)
      .post(`/api/v1/assessments/${assessmentId}/submissions`)
      .set(auth(studentToken))
      .send({ content: 'Rubric submission' });
    expect(submit.status).toBe(201);
    const submissionId = submit.body.data.id;

    const invalid = await request(app)
      .put(`/api/v1/submissions/${submissionId}/grades`)
      .set(auth(tutorToken))
      .send({
        grades: [{ itemId: item.id, marks: 0, state: 'GRADED' }],
        criterionGrades: [{ criterionId: item.rubricCriteria[0].id, marks: 9 }],
      });
    expect(invalid.status).toBe(400);

    const graded = await request(app)
      .put(`/api/v1/submissions/${submissionId}/grades`)
      .set(auth(tutorToken))
      .send({
        grades: [{ itemId: item.id, marks: 0, state: 'GRADED' }],
        criterionGrades: [
          { criterionId: item.rubricCriteria[0].id, marks: 7, feedback: 'Solid evidence' },
          { criterionId: item.rubricCriteria[1].id, marks: 10, feedback: 'Good analysis' },
        ],
      });
    expect(graded.status).toBe(200);

    const stored = await prisma.submissionItemGrade.findFirstOrThrow({
      where: { submissionId, itemId: item.id },
    });
    expect(Number(stored.marks)).toBe(17);
    const criterionGrades = await prisma.submissionCriterionGrade.findMany({ where: { submissionId } });
    expect(criterionGrades).toHaveLength(2);
    expect(Number(criterionGrades.reduce((sum, grade) => sum + Number(grade.marks), 0))).toBe(17);
  });

  it('publishes learning materials only to enrolled students', async () => {
    const scenario = await createScenario();
    const tutorToken = tokenFor(scenario.tutor);
    const studentToken = tokenFor(scenario.students[0]);

    const draft = await request(app)
      .post(`/api/v1/offerings/${scenario.offering.id}/materials`)
      .set(auth(tutorToken))
      .send({ title: 'Draft reading', url: 'https://example.edu/draft.pdf', isPublished: false });
    expect(draft.status).toBe(201);

    const published = await request(app)
      .post(`/api/v1/offerings/${scenario.offering.id}/materials`)
      .set(auth(tutorToken))
      .send({ title: 'Week 1 reading', description: 'Core reading', url: 'https://example.edu/week1.pdf', isPublished: true });
    expect(published.status).toBe(201);

    const studentView = await request(app)
      .get(`/api/v1/offerings/${scenario.offering.id}/materials`)
      .set(auth(studentToken));
    expect(studentView.status).toBe(200);
    expect(studentView.body.data).toHaveLength(1);
    expect(studentView.body.data[0].title).toBe('Week 1 reading');

    const forbidden = await request(app)
      .post(`/api/v1/offerings/${scenario.offering.id}/materials`)
      .set(auth(studentToken))
      .send({ title: 'Student upload', url: 'https://example.edu/x.pdf' });
    expect(forbidden.status).toBe(403);
  });

  it('rejects evidence mapped to a CLO of another course', async () => {
    const scenario = await createScenario();
    const response = await request(app)
      .post('/api/v1/assessments')
      .set(auth(tokenFor(scenario.tutor)))
      .send({
        offeringId: scenario.offering.id,
        title: 'Cross-course evidence',
        type: 'QUIZ',
        items: [
          {
            label: 'Invalid item',
            maxMarks: 10,
            cloMappings: [{ cloId: scenario.otherClo.id, weight: 1 }],
          },
        ],
      });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/does not belong/i);
  });

  it('enforces enrolment uniqueness and rejects duplicate programme codes', async () => {
    const scenario = await createScenario();
    const adminToken = tokenFor(scenario.admin);

    const enrol = await request(app)
      .post(`/api/v1/offerings/${scenario.offering.id}/enrollments`)
      .set(auth(adminToken))
      .send({ studentIds: [scenario.students[0].studentProfile!.id] });
    expect(enrol.status).toBe(200);
    const count = await prisma.enrollment.count({
      where: { offeringId: scenario.offering.id, studentId: scenario.students[0].studentProfile!.id },
    });
    expect(count).toBe(1);

    const duplicateProgramme = await request(app)
      .post('/api/v1/programs')
      .set(auth(adminToken))
      .send({ departmentId: scenario.department.id, name: 'Duplicate', code: 'BSCS', creditHours: 130 });
    expect(duplicateProgramme.status).toBe(409);
  });

  it('rejects a CLO-to-PLO mapping across programmes', async () => {
    const scenario = await createScenario();
    const response = await request(app)
      .post('/api/v1/clo-plo-mappings')
      .set(auth(tokenFor(scenario.admin)))
      .send({ cloId: scenario.clo.id, ploId: scenario.otherPlo.id, weight: 3 });
    expect(response.status).toBe(400);
  });

  it('creates versioned policies and keeps historical run snapshots', async () => {
    const scenario = await createScenario();
    const adminToken = tokenFor(scenario.admin);
    const tutorToken = tokenFor(scenario.tutor);

    const assessment = await prisma.assessment.create({
      data: {
        offeringId: scenario.offering.id,
        title: 'Policy test',
        type: 'QUIZ',
        maxMarks: 100,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        resultsPublishedAt: new Date(),
        createdById: scenario.tutor.id,
        items: {
          create: [
            {
              label: 'Item',
              maxMarks: 100,
              position: 0,
              cloMappings: { create: [{ cloId: scenario.clo.id, weight: 1 }] },
            },
          ],
        },
      },
      include: { items: true },
    });
    for (const [index, student] of scenario.students.entries()) {
      const submission = await prisma.submission.create({
        data: { assessmentId: assessment.id, studentId: student.studentProfile!.id, status: 'GRADED', content: 'x' },
      });
      await prisma.submissionItemGrade.create({
        data: {
          submissionId: submission.id,
          itemId: assessment.items[0].id,
          marks: [90, 80, 70, 60, 50][index],
          state: 'GRADED',
          gradedById: scenario.tutor.id,
        },
      });
    }

    const first = await request(app)
      .post(`/api/v1/offerings/${scenario.offering.id}/attainment-runs`)
      .set(auth(tutorToken))
      .send({});
    expect(first.status).toBe(201);

    const newPolicy = await request(app)
      .post('/api/v1/attainment-policies')
      .set(auth(adminToken))
      .send({
        name: 'Stricter policy',
        version: 'test-2',
        config: { ...scenario.policy.config, cohortAttainmentTarget: 90 },
        isActive: true,
      });
    expect(newPolicy.status).toBe(201);

    const second = await request(app)
      .post(`/api/v1/offerings/${scenario.offering.id}/attainment-runs`)
      .set(auth(tutorToken))
      .send({});
    expect(second.status).toBe(201);
    expect(second.body.data.policyVersion).toBe('test-2');

    const runs = await prisma.attainmentRun.findMany({ where: { offeringId: scenario.offering.id }, orderBy: { computedAt: 'asc' } });
    expect(runs).toHaveLength(2);
    expect(runs[0].policyVersion).toBe('test-1');
    expect(runs[1].policyVersion).toBe('test-2');
    expect((runs[0].policySnapshot as Record<string, unknown>).cohortAttainmentTarget).toBe(65);
    expect((runs[1].policySnapshot as Record<string, unknown>).cohortAttainmentTarget).toBe(90);
  });

  it('serves each role dashboard without cross-router authorization leakage', async () => {
    const scenario = await createScenario();
    for (const user of [scenario.admin, scenario.tutor, scenario.students[0]]) {
      const response = await request(app).get('/api/v1/dashboard').set(auth(tokenFor(user)));
      expect(response.status, `${user.role} dashboard`).toBe(200);
    }
    const tutorReports = await request(app).get('/api/v1/reports/attainment').set(auth(tokenFor(scenario.tutor)));
    expect(tutorReports.status).toBe(200);
  });

  it('validates request bodies and returns a consistent error envelope', async () => {
    const scenario = await createScenario();
    const response = await request(app)
      .post('/api/v1/semesters')
      .set(auth(tokenFor(scenario.admin)))
      .send({ name: 'X', startDate: 'not-a-date', endDate: 'also-not-a-date' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(response.body.error.details)).toBe(true);
    expect(response.body.meta.requestId).toBeTypeOf('string');
  });
});
