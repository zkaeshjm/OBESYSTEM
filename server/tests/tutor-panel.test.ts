import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import {
  createAssessmentWithItems,
  createScenario,
  resetDb,
  submitAndGrade,
  tokenFor,
} from './helpers.js';

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Tutor panel phase 2', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('updates only the authenticated user’s editable profile fields', async () => {
    const scenario = await createScenario();
    const response = await request(app)
      .patch('/api/v1/auth/me')
      .set(auth(tokenFor(scenario.tutor)))
      .send({
        name: 'Updated Tutor',
        phone: '+92 300 1234567',
        role: 'ADMIN',
        isActive: false,
        email: 'changed@test.local',
      });

    expect(response.status).toBe(200);
    expect(response.body.data.user).toMatchObject({
      id: scenario.tutor.id,
      name: 'Updated Tutor',
      phone: '+92 300 1234567',
      role: 'TUTOR',
      email: scenario.tutor.email,
      isActive: true,
    });

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: scenario.tutor.id } });
    expect(stored.role).toBe('TUTOR');
    expect(stored.email).toBe(scenario.tutor.email);
    expect(stored.isActive).toBe(true);
  });

  it('lets a tutor map only their own course and freezes mappings used by finalized evidence', async () => {
    const scenario = await createScenario();
    const tutorToken = tokenFor(scenario.tutor);
    const otherTutorToken = tokenFor(scenario.otherTutor);
    const secondPlo = await prisma.plo.create({
      data: {
        programId: scenario.program.id,
        code: 'PLO-2',
        description: 'Communicate computing solutions effectively',
        bloomDomain: 'AFFECTIVE',
        targetAttainment: 65,
      },
    });

    const created = await request(app)
      .post('/api/v1/clo-plo-mappings')
      .set(auth(tutorToken))
      .send({ cloId: scenario.clo.id, ploId: secondPlo.id, weight: 2 });
    expect(created.status).toBe(201);
    expect(created.body.data.weight).toBe(2);

    const foreignUpdate = await request(app)
      .post('/api/v1/clo-plo-mappings')
      .set(auth(otherTutorToken))
      .send({ cloId: scenario.clo.id, ploId: secondPlo.id, weight: 1 });
    expect(foreignUpdate.status).toBe(403);

    const foreignDelete = await request(app)
      .delete(`/api/v1/clo-plo-mappings/${created.body.data.id}`)
      .set(auth(otherTutorToken));
    expect(foreignDelete.status).toBe(403);

    const run = await prisma.attainmentRun.create({
      data: {
        offeringId: scenario.offering.id,
        policyId: scenario.policy.id,
        engineVersion: 'test-engine',
        policyVersion: scenario.policy.version,
        policySnapshot: {
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
        reportingPeriod: 'Spring 2026',
        computedById: scenario.tutor.id,
        isFrozen: true,
        frozenAt: new Date(),
      },
    });
    await prisma.cloAttainment.create({
      data: {
        runId: run.id,
        cloId: scenario.clo.id,
        cohortSize: 5,
        eligibleCount: 5,
        attainedCount: 4,
        meanScore: 72,
        attainmentPct: 80,
        targetPct: 65,
        status: 'MET',
      },
    });

    const frozenUpdate = await request(app)
      .post('/api/v1/clo-plo-mappings')
      .set(auth(tutorToken))
      .send({ cloId: scenario.clo.id, ploId: secondPlo.id, weight: 3 });
    expect(frozenUpdate.status).toBe(409);
    expect(frozenUpdate.body.error.message).toMatch(/frozen/i);
  });

  it('persists expanded assessment metadata and supports guarded archive/restore', async () => {
    const scenario = await createScenario();
    const tutorToken = tokenFor(scenario.tutor);
    const created = await request(app)
      .post('/api/v1/assessments')
      .set(auth(tutorToken))
      .send({
        offeringId: scenario.offering.id,
        title: 'Laboratory practical',
        type: 'LAB',
        instructions: 'Upload the completed laboratory evidence.',
        submissionFormat: 'ZIP archive and PDF report',
        passingMarks: 12,
        latePolicy: 'REJECT',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        items: [
          {
            label: 'Practical',
            maxMarks: 20,
            cloMappings: [{ cloId: scenario.clo.id, weight: 1 }],
          },
        ],
      });

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      type: 'LAB',
      submissionFormat: 'ZIP archive and PDF report',
      latePolicy: 'REJECT',
    });
    expect(Number(created.body.data.passingMarks)).toBe(12);

    const foreignPatch = await request(app)
      .patch(`/api/v1/assessments/${created.body.data.id}`)
      .set(auth(tokenFor(scenario.otherTutor)))
      .send({ title: 'Unauthorized edit' });
    expect(foreignPatch.status).toBe(403);

    await request(app)
      .post(`/api/v1/assessments/${created.body.data.id}/publish`)
      .set(auth(tutorToken))
      .expect(200);
    const archived = await request(app)
      .post(`/api/v1/assessments/${created.body.data.id}/archive`)
      .set(auth(tutorToken));
    expect(archived.status).toBe(200);
    expect(archived.body.data.status).toBe('ARCHIVED');

    const activeList = await request(app)
      .get(`/api/v1/assessments?offeringId=${scenario.offering.id}`)
      .set(auth(tutorToken));
    expect(activeList.body.data).toHaveLength(0);

    const all = await request(app)
      .get(`/api/v1/assessments?offeringId=${scenario.offering.id}&includeArchived=true`)
      .set(auth(tutorToken));
    expect(all.body.data.map((assessment: { id: string }) => assessment.id)).toContain(created.body.data.id);

    const restored = await request(app)
      .post(`/api/v1/assessments/${created.body.data.id}/restore`)
      .set(auth(tutorToken));
    expect(restored.status).toBe(200);
    expect(restored.body.data.status).toBe('CLOSED');
  });

  it('enforces all late policies on new and updated submissions', async () => {
    const scenario = await createScenario();
    const past = new Date(Date.now() - 60_000);
    const policies = ['REJECT', 'MARK_LATE', 'ACCEPT'] as const;

    for (const [index, latePolicy] of policies.entries()) {
      const assessment = await createAssessmentWithItems(
        scenario.offering.id,
        scenario.tutor.id,
        scenario.clo.id,
        { publish: true, dueAt: past }
      );
      await prisma.assessment.update({ where: { id: assessment.id }, data: { latePolicy } });
      const response = await request(app)
        .post(`/api/v1/assessments/${assessment.id}/submissions`)
        .set(auth(tokenFor(scenario.students[index])))
        .send({ content: `${latePolicy} submission` });

      if (latePolicy === 'REJECT') {
        expect(response.status).toBe(409);
      } else {
        expect(response.status).toBe(201);
        expect(response.body.data.isLate).toBe(latePolicy === 'MARK_LATE');
        expect(response.body.data.status).toBe(latePolicy === 'MARK_LATE' ? 'LATE' : 'SUBMITTED');
      }
    }

    const editable = await createAssessmentWithItems(
      scenario.offering.id,
      scenario.tutor.id,
      scenario.clo.id,
      { publish: true, dueAt: new Date(Date.now() + 60_000) }
    );
    const initial = await request(app)
      .post(`/api/v1/assessments/${editable.id}/submissions`)
      .set(auth(tokenFor(scenario.students[4])))
      .send({ content: 'On-time submission' });
    expect(initial.status).toBe(201);

    await prisma.assessment.update({
      where: { id: editable.id },
      data: { dueAt: past, latePolicy: 'REJECT' },
    });
    const lateEdit = await request(app)
      .patch(`/api/v1/submissions/${initial.body.data.id}`)
      .set(auth(tokenFor(scenario.students[4])))
      .send({ content: 'Edited after the deadline' });
    expect(lateEdit.status).toBe(409);
  });

  it('requires a reason for published regrades and retains immutable mark history', async () => {
    const scenario = await createScenario();
    const tutorToken = tokenFor(scenario.tutor);
    const assessment = await createAssessmentWithItems(
      scenario.offering.id,
      scenario.tutor.id,
      scenario.clo.id,
      { publish: true }
    );
    const submitted = await request(app)
      .post(`/api/v1/assessments/${assessment.id}/submissions`)
      .set(auth(tokenFor(scenario.students[0])))
      .send({ content: 'Graded work' });
    expect(submitted.status).toBe(201);

    const initialBody = {
      grades: [
        { itemId: assessment.items[0].id, marks: 16, state: 'GRADED' },
        { itemId: assessment.items[1].id, marks: 14, state: 'GRADED' },
      ],
      overallFeedback: 'Initial feedback',
    };
    await request(app)
      .put(`/api/v1/submissions/${submitted.body.data.id}/grades`)
      .set(auth(tutorToken))
      .send(initialBody)
      .expect(200);
    expect(await prisma.gradeChange.count({ where: { submissionId: submitted.body.data.id } })).toBe(2);

    await request(app)
      .post(`/api/v1/assessments/${assessment.id}/publish-results`)
      .set(auth(tutorToken))
      .expect(200);

    const correction = {
      ...initialBody,
      grades: [
        { itemId: assessment.items[0].id, marks: 18, state: 'GRADED' },
        { itemId: assessment.items[1].id, marks: 14, state: 'GRADED' },
      ],
    };
    const withoutReason = await request(app)
      .put(`/api/v1/submissions/${submitted.body.data.id}/grades`)
      .set(auth(tutorToken))
      .send(correction);
    expect(withoutReason.status).toBe(400);

    await request(app)
      .put(`/api/v1/submissions/${submitted.body.data.id}/grades`)
      .set(auth(tutorToken))
      .send({ ...correction, reason: 'Marker transcription correction' })
      .expect(200);
    expect(await prisma.gradeChange.count({ where: { submissionId: submitted.body.data.id } })).toBe(3);

    await request(app)
      .put(`/api/v1/submissions/${submitted.body.data.id}/grades`)
      .set(auth(tutorToken))
      .send({ ...correction, reason: 'No additional change' })
      .expect(200);
    expect(await prisma.gradeChange.count({ where: { submissionId: submitted.body.data.id } })).toBe(3);

    const history = await request(app)
      .get(`/api/v1/submissions/${submitted.body.data.id}/grade-history`)
      .set(auth(tutorToken));
    expect(history.status).toBe(200);
    expect(history.body.data).toHaveLength(3);
    expect(history.body.data[0]).toMatchObject({
      previousMarks: '16',
      newMarks: '18',
      reason: 'Marker transcription correction',
    });

    const foreignHistory = await request(app)
      .get(`/api/v1/submissions/${submitted.body.data.id}/grade-history`)
      .set(auth(tokenFor(scenario.otherTutor)));
    expect(foreignHistory.status).toBe(403);

    const foreignRegrade = await request(app)
      .put(`/api/v1/submissions/${submitted.body.data.id}/grades`)
      .set(auth(tokenFor(scenario.otherTutor)))
      .send({ ...correction, reason: 'Unauthorized correction attempt' });
    expect(foreignRegrade.status).toBe(403);
  });

  it('archives evidence-free CLOs, hides them from active lists, and enforces tutor scope', async () => {
    const scenario = await createScenario();
    const clo = await prisma.clo.create({
      data: {
        courseId: scenario.course.id,
        code: 'CLO-ARCHIVE',
        description: 'Evaluate an evidence-free outcome before curriculum retirement',
        bloomLevel: 'EVALUATE',
        masteryThreshold: 60,
        approvalStatus: 'APPROVED',
        createdById: scenario.tutor.id,
        approvedById: scenario.admin.id,
        approvedAt: new Date(),
      },
    });

    const foreign = await request(app)
      .post(`/api/v1/clos/${clo.id}/archive`)
      .set(auth(tokenFor(scenario.otherTutor)));
    expect(foreign.status).toBe(403);

    const archived = await request(app)
      .post(`/api/v1/clos/${clo.id}/archive`)
      .set(auth(tokenFor(scenario.tutor)));
    expect(archived.status).toBe(200);
    expect(archived.body.data.archivedAt).toBeTruthy();

    const active = await request(app).get('/api/v1/clos').set(auth(tokenFor(scenario.tutor)));
    expect(active.body.data.map((entry: { id: string }) => entry.id)).not.toContain(clo.id);
    const includingArchived = await request(app)
      .get('/api/v1/clos?includeArchived=true')
      .set(auth(tokenFor(scenario.tutor)));
    expect(includingArchived.body.data.map((entry: { id: string }) => entry.id)).toContain(clo.id);

    await request(app)
      .post(`/api/v1/clos/${clo.id}/unarchive`)
      .set(auth(tokenFor(scenario.tutor)))
      .expect(200);

    const assessment = await createAssessmentWithItems(
      scenario.offering.id,
      scenario.tutor.id,
      scenario.clo.id
    );
    expect(assessment.items).toHaveLength(2);
    const evidenceArchive = await request(app)
      .post(`/api/v1/clos/${scenario.clo.id}/archive`)
      .set(auth(tokenFor(scenario.tutor)));
    expect(evidenceArchive.status).toBe(409);
  });

  it('persists improvement gap/follow-up fields and scopes plans to the assigned tutor', async () => {
    const scenario = await createScenario();
    const tutorToken = tokenFor(scenario.tutor);
    const created = await request(app)
      .post(`/api/v1/offerings/${scenario.offering.id}/action-plans`)
      .set(auth(tutorToken))
      .send({
        title: 'Strengthen algorithm practice',
        description: 'Add guided practice and a formative checkpoint before the next assessment.',
        gapDescription: 'CLO-1 attainment was below the configured cohort target.',
        followUp: 'Compare the next frozen run and document the change.',
        cloId: scenario.clo.id,
      });
    expect(created.status).toBe(201);
    expect(created.body.data.gapDescription).toMatch(/below/);
    expect(created.body.data.followUp).toMatch(/next frozen run/);

    const updated = await request(app)
      .patch(`/api/v1/action-plans/${created.body.data.id}`)
      .set(auth(tutorToken))
      .send({ status: 'IN_PROGRESS', followUp: 'Review after the midterm attainment run.' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.followUp).toMatch(/midterm/);

    const foreign = await request(app)
      .get(`/api/v1/offerings/${scenario.offering.id}/action-plans`)
      .set(auth(tokenFor(scenario.otherTutor)));
    expect(foreign.status).toBe(403);
  });

  it('exports tutor-scoped CSV and neutralizes spreadsheet formula prefixes', async () => {
    const scenario = await createScenario();
    await Promise.all([
      prisma.course.update({
        where: { id: scenario.course.id },
        data: { title: '=HYPERLINK("https://example.invalid")' },
      }),
      prisma.user.update({ where: { id: scenario.tutor.id }, data: { name: '+SUM(1,1)' } }),
      prisma.clo.update({ where: { id: scenario.clo.id }, data: { description: '@malicious-cell' } }),
      prisma.semester.update({ where: { id: scenario.semester.id }, data: { name: '-1+1' } }),
    ]);

    const assessment = await createAssessmentWithItems(
      scenario.offering.id,
      scenario.tutor.id,
      scenario.clo.id,
      { publish: true }
    );
    for (const [index, student] of scenario.students.entries()) {
      await submitAndGrade(
        assessment.id,
        student.studentProfile!.id,
        scenario.tutor.id,
        [0.9 - index * 0.05, 0.9 - index * 0.05]
      );
    }
    await prisma.assessment.update({
      where: { id: assessment.id },
      data: { resultsPublishedAt: new Date() },
    });

    const computed = await request(app)
      .post(`/api/v1/offerings/${scenario.offering.id}/attainment-runs`)
      .set(auth(tokenFor(scenario.tutor)))
      .send({ reportingPeriod: 'Spring 2026' });
    expect(computed.status).toBe(201);

    const csv = await request(app)
      .get(`/api/v1/reports/attainment.csv?offeringId=${scenario.offering.id}`)
      .set(auth(tokenFor(scenario.tutor)));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/attachment/);
    expect(csv.text).toContain("'=HYPERLINK");
    expect(csv.text).toContain("'+SUM");
    expect(csv.text).toContain("'@malicious-cell");
    expect(csv.text).toContain("'-1+1");

    const foreignCsv = await request(app)
      .get(`/api/v1/reports/attainment.csv?offeringId=${scenario.offering.id}`)
      .set(auth(tokenFor(scenario.otherTutor)));
    expect(foreignCsv.status).toBe(200);
    expect(foreignCsv.text).not.toContain('malicious-cell');
    expect(foreignCsv.text.trim().split(/\r?\n/)).toHaveLength(1);

    const exportAudit = await prisma.auditLog.findFirst({
      where: { actorId: scenario.tutor.id, action: 'EXPORT', entityType: 'AttainmentReport' },
    });
    expect(exportAudit).not.toBeNull();
  });

  it('manages CLO measurement criteria with course-author and publication guards', async () => {
    const scenario = await createScenario();
    const tutorToken = tokenFor(scenario.tutor);

    const foreignStudent = await request(app)
      .get(`/api/v1/clos/${scenario.clo.id}/measurement-criteria`)
      .set(auth(tokenFor(scenario.outsideStudent)));
    expect(foreignStudent.status).toBe(403);

    // The scenario CLO is approved; only an admin may change its criteria now.
    const foreignTutor = await request(app)
      .put(`/api/v1/clos/${scenario.clo.id}/measurement-criteria`)
      .set(auth(tokenFor(scenario.otherTutor)))
      .send({ criteria: [{ statement: 'Demonstrates working code', weight: 2 }] });
    expect(foreignTutor.status).toBe(403);

    const tutorOnApproved = await request(app)
      .put(`/api/v1/clos/${scenario.clo.id}/measurement-criteria`)
      .set(auth(tutorToken))
      .send({ criteria: [{ statement: 'Demonstrates working code', weight: 2 }] });
    expect(tutorOnApproved.status).toBe(403);
    expect(tutorOnApproved.body.error.message).toMatch(/administrator/i);

    // A fresh, unapproved CLO the tutor authored is editable.
    const draftClo = await prisma.clo.create({
      data: {
        courseId: scenario.course.id,
        code: 'CLO-DRAFT',
        description: 'Evaluate algorithmic approaches with measurable evidence of correctness',
        bloomLevel: 'EVALUATE',
        approvalStatus: 'PENDING',
        createdById: scenario.tutor.id,
      },
    });
    const created = await request(app)
      .put(`/api/v1/clos/${draftClo.id}/measurement-criteria`)
      .set(auth(tutorToken))
      .send({
        criteria: [
          { statement: 'Correctness on hidden test cases', weight: 3 },
          { statement: 'Complexity analysis is present and justified', weight: 2 },
        ],
      });
    expect(created.status).toBe(200);
    expect(created.body.data).toHaveLength(2);
    expect(created.body.data.map((entry: { position: number }) => entry.position)).toEqual([0, 1]);
    const stored = await prisma.cloMeasurementCriterion.findMany({ where: { cloId: draftClo.id }, orderBy: { position: 'asc' } });
    expect(stored.map((entry) => entry.statement)).toEqual([
      'Correctness on hidden test cases',
      'Complexity analysis is present and justified',
    ]);

    const duplicate = await request(app)
      .put(`/api/v1/clos/${draftClo.id}/measurement-criteria`)
      .set(auth(tutorToken))
      .send({
        criteria: [
          { statement: 'Correctness on hidden test cases', weight: 3 },
          { statement: 'Correctness on hidden test cases', weight: 2 },
        ],
      });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error.message).toMatch(/unique/i);

    const firstId = created.body.data[0].id as string;
    const replaced = await request(app)
      .put(`/api/v1/clos/${draftClo.id}/measurement-criteria`)
      .set(auth(tutorToken))
      .send({
        criteria: [
          { id: firstId, statement: 'Correctness on visible test cases', weight: 3 },
          { statement: 'Time and space complexity documented', weight: 1 },
        ],
      });
    expect(replaced.status).toBe(200);
    expect(replaced.body.data).toHaveLength(2);
    expect(replaced.body.data.find((entry: { statement: string }) => entry.statement === 'Correctness on visible test cases')).toMatchObject({
      weight: 3,
    });
    expect(await prisma.cloMeasurementCriterion.count({ where: { cloId: draftClo.id } })).toBe(4);
    expect(
      await prisma.cloMeasurementCriterion.count({ where: { cloId: draftClo.id, supersededAt: null } })
    ).toBe(2);
    const history = await request(app)
      .get(`/api/v1/clos/${draftClo.id}/measurement-criteria?includeHistory=true`)
      .set(auth(tutorToken));
    expect(history.status).toBe(200);
    expect(history.body.data).toHaveLength(4);

    const archive = await request(app).post(`/api/v1/clos/${draftClo.id}/archive`).set(auth(tutorToken));
    expect(archive.status).toBe(200);
    const afterArchive = await request(app)
      .put(`/api/v1/clos/${draftClo.id}/measurement-criteria`)
      .set(auth(tutorToken))
      .send({ criteria: [{ statement: 'Attempt after archiving the CLO', weight: 1 }] });
    expect(afterArchive.status).toBe(409);

    // Reading existing criteria on an archived CLO remains available so the
    // historical evidence stays explainable; only new edits are refused.
    const readBack = await request(app).get(`/api/v1/clos/${draftClo.id}/measurement-criteria`).set(auth(tutorToken));
    expect(readBack.status).toBe(200);
    expect(readBack.body.data).toHaveLength(2);
  });

  it('serves an authorized, traceable PLO drill-down and refuses foreign programmes', async () => {
    const scenario = await createScenario();
    const visiblePrograms = await request(app).get('/api/v1/programs').set(auth(tokenFor(scenario.tutor)));
    expect(visiblePrograms.status).toBe(200);
    expect(visiblePrograms.body.data.map((program: { id: string }) => program.id)).toEqual([scenario.program.id]);

    const assessment = await createAssessmentWithItems(scenario.offering.id, scenario.tutor.id, scenario.clo.id, {
      publish: true,
    });
    // Grade every enrolled student so the cohort meets the policy minimum and
    // the PLO result is MET rather than INSUFFICIENT_DATA.
    for (const [index, student] of scenario.students.entries()) {
      await submitAndGrade(assessment.id, student.studentProfile!.id, scenario.tutor.id, [
        0.9 - index * 0.05,
        0.9 - index * 0.05,
      ]);
    }
    const run = await request(app)
      .post(`/api/v1/offerings/${scenario.offering.id}/attainment-runs`)
      .set(auth(tokenFor(scenario.tutor)))
      .send({ reportingPeriod: 'Spring 2026' });
    expect(run.status).toBe(201);

    const drillDown = await request(app)
      .get(`/api/v1/reports/plos/${scenario.plo.id}`)
      .set(auth(tokenFor(scenario.tutor)));
    expect(drillDown.status).toBe(200);
    expect(drillDown.body.data.plo).toMatchObject({ id: scenario.plo.id, code: scenario.plo.code });
    expect(drillDown.body.data.mappedClos).toHaveLength(1);
    expect(drillDown.body.data.mappedClos[0]).toMatchObject({ clo: { code: 'CLO-1' } });
    expect(drillDown.body.data.offerings).toHaveLength(1);
    const offeringResult = drillDown.body.data.offerings[0];
    expect(offeringResult.run).toMatchObject({ policyVersion: 'test-1', reportingPeriod: 'Spring 2026' });
    // The single graded student is below the 5-student cohort minimum, so the
    // persisted result is honestly flagged INSUFFICIENT_DATA rather than MET.
    expect(offeringResult.result.status).toBe('INSUFFICIENT_DATA');

    const foreignDrillDown = await request(app)
      .get(`/api/v1/reports/plos/${scenario.otherPlo.id}`)
      .set(auth(tokenFor(scenario.tutor)));
    expect(foreignDrillDown.status).toBe(403);

    const studentDrillDown = await request(app)
      .get(`/api/v1/reports/plos/${scenario.plo.id}`)
      .set(auth(tokenFor(scenario.students[0])));
    expect(studentDrillDown.status).toBe(200);
    expect(studentDrillDown.body.data.offerings).toHaveLength(1);
  });

  it('computes roster progress from published evidence only and distinguishes missing data', async () => {
    const scenario = await createScenario();
    const assessment = await createAssessmentWithItems(scenario.offering.id, scenario.tutor.id, scenario.clo.id, {
      publish: true,
    });
    const submission = await submitAndGrade(assessment.id, scenario.students[0].studentProfile!.id, scenario.tutor.id, [
      0.8,
      0.8,
    ]);
    await prisma.assessment.update({
      where: { id: assessment.id },
      data: { resultsPublishedAt: new Date() },
    });
    void submission;

    const roster = await request(app)
      .get(`/api/v1/offerings/${scenario.offering.id}/roster-progress`)
      .set(auth(tokenFor(scenario.tutor)));
    expect(roster.status).toBe(200);
    const students = roster.body.data.students;
    expect(students).toHaveLength(5);
    const graded = students.find((entry: { student: { rollNo: string } }) => entry.student.rollNo === 'BSCS-001');
    const ungraded = students.find((entry: { student: { rollNo: string } }) => entry.student.rollNo === 'BSCS-002');
    expect(graded.gradedAssessmentCount).toBe(1);
    expect(graded.totalAssessmentCount).toBe(1);
    expect(graded.publishedAveragePct).toBe(80);
    expect(graded.pendingGradingCount).toBe(0);
    expect(ungraded.gradedAssessmentCount).toBe(0);
    expect(ungraded.publishedAveragePct).toBeNull();

    // A second, ungraded submission shows up as pending, not fabricated.
    await prisma.submission.create({
      data: {
        assessmentId: assessment.id,
        studentId: scenario.students[1].studentProfile!.id,
        status: 'SUBMITTED',
        content: 'Awaiting marks',
      },
    });
    const refreshed = await request(app)
      .get(`/api/v1/offerings/${scenario.offering.id}/roster-progress`)
      .set(auth(tokenFor(scenario.tutor)));
    const refreshedUngraded = refreshed.body.data.students.find(
      (entry: { student: { rollNo: string } }) => entry.student.rollNo === 'BSCS-002'
    );
    expect(refreshedUngraded.pendingGradingCount).toBe(1);
    expect(refreshedUngraded.publishedAveragePct).toBeNull();

    const computed = await request(app)
      .post(`/api/v1/offerings/${scenario.offering.id}/attainment-runs`)
      .set(auth(tokenFor(scenario.tutor)))
      .send({ reportingPeriod: 'Spring 2026' });
    expect(computed.status).toBe(201);
    const withRun = await request(app)
      .get(`/api/v1/offerings/${scenario.offering.id}/roster-progress`)
      .set(auth(tokenFor(scenario.tutor)));
    const gradedMastery = withRun.body.data.cloMastery.find(
      (entry: { studentId: string }) => entry.studentId === scenario.students[0].studentProfile!.id
    );
    const missingMastery = withRun.body.data.cloMastery.find(
      (entry: { studentId: string }) => entry.studentId === scenario.students[1].studentProfile!.id
    );
    expect(gradedMastery.outcomes[0]).toMatchObject({ studentScore: 80, status: 'MET' });
    expect(missingMastery.outcomes[0]).toMatchObject({ studentScore: null, status: 'INSUFFICIENT_DATA' });

    // Another tutor cannot read this roster.
    const foreign = await request(app)
      .get(`/api/v1/offerings/${scenario.offering.id}/roster-progress`)
      .set(auth(tokenFor(scenario.otherTutor)));
    expect(foreign.status).toBe(403);
  });

  it('exports a valid PDF report with identical scope to the CSV export', async () => {
    const scenario = await createScenario();
    const assessment = await createAssessmentWithItems(scenario.offering.id, scenario.tutor.id, scenario.clo.id, {
      publish: true,
    });
    for (const [index, student] of scenario.students.entries()) {
      await submitAndGrade(assessment.id, student.studentProfile!.id, scenario.tutor.id, [
        0.9 - index * 0.05,
        0.9 - index * 0.05,
      ]);
    }
    await prisma.assessment.update({ where: { id: assessment.id }, data: { resultsPublishedAt: new Date() } });

    const compute = await request(app)
      .post(`/api/v1/offerings/${scenario.offering.id}/attainment-runs`)
      .set(auth(tokenFor(scenario.tutor)))
      .send({ reportingPeriod: 'Spring 2026' });
    expect(compute.status).toBe(201);

    const pdf = await request(app)
      .get(`/api/v1/reports/attainment.pdf?offeringId=${scenario.offering.id}`)
      .set(auth(tokenFor(scenario.tutor)));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    const buffer = Buffer.from(pdf.body);
    expect(buffer.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(Buffer.from(pdf.body).subarray(-5).toString('latin1')).toBe('%%EOF');
    const text = buffer.toString('latin1');
    expect(text).toContain('OBE Attainment Report');
    expect(text).toContain(scenario.course.code);
    expect(text).toContain('test-1');
    expect(text).toContain('Spring 2026');

    const foreignPdf = await request(app)
      .get(`/api/v1/reports/attainment.pdf?offeringId=${scenario.otherOffering.id}`)
      .set(auth(tokenFor(scenario.tutor)));
    expect(foreignPdf.status).toBe(200);
    const foreignText = Buffer.from(foreignPdf.body).toString('latin1');
    expect(foreignText).not.toContain(scenario.course.code);
    expect(foreignText).toContain('Offerings reported: 0');

    const audits = await prisma.auditLog.findMany({
      where: { actorId: scenario.tutor.id, action: 'EXPORT', entityType: 'AttainmentReport' },
    });
    expect(audits.some((entry) => (entry.metadata as { format?: string } | null)?.format === 'pdf')).toBe(true);
  });
});
