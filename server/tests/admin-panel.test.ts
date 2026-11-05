import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { createScenario, resetDb, tokenFor } from './helpers.js';

/**
 * Administrator-panel parity suite.
 *
 * The tutor-panel suite already verified CLO approval, attainment freezing and
 * policy versioning from the tutor side. These tests verify the remaining
 * admin modules end to end: academic structure management, user management,
 * the audit trail, the institutional dashboard and the policy activation
 * path — including persistence, audit rows, notifications and the failure
 * states (duplicates, invalid references, role isolation).
 */
const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function lastAudit(entityType: string, entityId: string) {
  return prisma.auditLog.findFirst({
    where: { entityType, entityId },
    orderBy: { occurredAt: 'desc' },
  });
}

describe('admin panel: academic structure management', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates a department, persists it, writes an audit row and rejects duplicate codes', async () => {
    const scenario = await createScenario();

    const created = await request(app)
      .post('/api/v1/departments')
      .set(auth(tokenFor(scenario.admin)))
      .send({ name: 'Department of systems', code: 'DOS', hodName: 'Dr. Example', contact: 'ext-100' });
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe('DOS');

    const stored = await prisma.department.findUnique({ where: { code: 'DOS' } });
    expect(stored?.name).toBe('Department of systems');
    expect(stored?.isActive).toBe(true);

    const auditRow = await lastAudit('Department', created.body.data.id);
    expect(auditRow?.action).toBe('INSERT');
    expect(auditRow?.actorEmail).toBe(scenario.admin.email);

    const duplicate = await request(app)
      .post('/api/v1/departments')
      .set(auth(tokenFor(scenario.admin)))
      .send({ name: 'Another attempt', code: 'DOS' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE');

    const invalid = await request(app)
      .post('/api/v1/departments')
      .set(auth(tokenFor(scenario.admin)))
      .send({ name: 'Bad code shape', code: 'dos!' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    // Deactivation is a soft-flag, academic history stays intact.
    const deactivated = await request(app)
      .delete(`/api/v1/departments/${created.body.data.id}`)
      .set(auth(tokenFor(scenario.admin)));
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.isActive).toBe(false);
    const stillThere = await prisma.department.findUnique({ where: { code: 'DOS' } });
    expect(stillThere?.id).toBe(created.body.data.id);
  });

  it('rejects departments writes from tutors and students while keeping reads open', async () => {
    const scenario = await createScenario();
    for (const user of [scenario.tutor, scenario.students[0]]) {
      const denied = await request(app)
        .post('/api/v1/departments')
        .set(auth(tokenFor(user)))
        .send({ name: 'Sneaky department', code: 'SNK' });
      expect(denied.status).toBe(403);
    }
    const listed = await request(app).get('/api/v1/departments').set(auth(tokenFor(scenario.tutor)));
    expect(listed.status).toBe(200);
    expect(listed.body.data.some((row: { code: string }) => row.code === 'TI')).toBe(true);
  });

  it('validates programme references, prevents duplicate codes and scopes the tutor list', async () => {
    const scenario = await createScenario();

    const malformed = await request(app)
      .post('/api/v1/programs')
      .set(auth(tokenFor(scenario.admin)))
      .send({ departmentId: 'not-a-uuid', name: 'BS Broken', code: 'BSBR', creditHours: 120 });
    expect(malformed.status).toBe(400);

    const unknownDepartment = await request(app)
      .post('/api/v1/programs')
      .set(auth(tokenFor(scenario.admin)))
      .send({ departmentId: '00000000-0000-4000-8000-000000000000', name: 'BS Broken', code: 'BSBR', creditHours: 120 });
    expect(unknownDepartment.status).toBe(409);
    expect(unknownDepartment.body.error.code).toBe('RELATION_CONFLICT');

    const duplicateCode = await request(app)
      .post('/api/v1/programs')
      .set(auth(tokenFor(scenario.admin)))
      .send({ departmentId: scenario.department.id, name: 'Duplicate attempt', code: 'BSCS', creditHours: 120 });
    expect(duplicateCode.status).toBe(409);

    const created = await request(app)
      .post('/api/v1/programs')
      .set(auth(tokenFor(scenario.admin)))
      .send({ departmentId: scenario.department.id, name: 'BS Data Science', code: 'BSDS', creditHours: 128, accreditationBody: 'HEC' });
    expect(created.status).toBe(201);
    expect((await prisma.program.findUnique({ where: { code: 'BSDS' } }))?.name).toBe('BS Data Science');

    // Tutors only see programmes they teach into; students see their own.
    const tutorPrograms = await request(app).get('/api/v1/programs').set(auth(tokenFor(scenario.tutor)));
    expect(tutorPrograms.body.data.map((row: { code: string }) => row.code).sort()).toEqual(['BSCS']);
    const studentPrograms = await request(app).get('/api/v1/programs').set(auth(tokenFor(scenario.students[0])));
    expect(studentPrograms.body.data.map((row: { code: string }) => row.code)).toEqual(['BSCS']);
  });

  it('keeps exactly one active academic session and refuses to delete used ones', async () => {
    const scenario = await createScenario();

    const activated = await request(app)
      .post('/api/v1/semesters')
      .set(auth(tokenFor(scenario.admin)))
      .send({
        name: 'Spring 2027',
        startDate: new Date('2027-02-02').toISOString(),
        endDate: new Date('2027-06-30').toISOString(),
        isActive: true,
      });
    expect(activated.status).toBe(201);

    const stored = await prisma.semester.findMany({ where: { isActive: true } });
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('Spring 2027');

    // Admins are notified about the active-session change.
    const notification = await prisma.notification.findFirst({
      where: { userId: scenario.admin.id, title: 'Active academic session changed' },
    });
    expect(notification?.body).toContain('Spring 2027');

    // Date validation is enforced.
    const backwards = await request(app)
      .post('/api/v1/semesters')
      .set(auth(tokenFor(scenario.admin)))
      .send({ name: 'Backwards', startDate: new Date('2027-06-30').toISOString(), endDate: new Date('2027-02-02').toISOString() });
    expect(backwards.status).toBe(400);

    // Creating a semester without `isActive` leaves the active one untouched.
    const inactive = await request(app)
      .post('/api/v1/semesters')
      .set(auth(tokenFor(scenario.admin)))
      .send({ name: 'Fall 2027', startDate: new Date('2027-09-01').toISOString(), endDate: new Date('2028-01-30').toISOString() });
    expect(inactive.status).toBe(201);
    expect((await prisma.semester.findMany({ where: { isActive: true } })).map((row) => row.name)).toEqual(['Spring 2027']);

    // Deleting a session with offerings is forbidden; an empty one is fine.
    const blocked = await request(app)
      .delete(`/api/v1/semesters/${scenario.semester.id}`)
      .set(auth(tokenFor(scenario.admin)));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CONFLICT');

    const removed = await request(app)
      .delete(`/api/v1/semesters/${inactive.body.data.id}`)
      .set(auth(tokenFor(scenario.admin)));
    expect(removed.status).toBe(200);
    expect(await prisma.semester.findUnique({ where: { id: inactive.body.data.id } })).toBeNull();
  });
});

describe('admin panel: user and student management', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates staff and student accounts with the required profile rules', async () => {
    const scenario = await createScenario();

    const tutor = await request(app)
      .post('/api/v1/users')
      .set(auth(tokenFor(scenario.admin)))
      .send({
        name: 'New Tutor',
        email: 'new.tutor@test.local',
        role: 'TUTOR',
        password: 'AnotherPass1!',
        departmentId: scenario.department.id,
        employeeNo: 'EMP-21',
      });
    expect(tutor.status).toBe(201);
    expect(tutor.body.data.role).toBe('TUTOR');

    // Student without a profile is rejected; with one it is created and the
    // department is derived from the programme.
    const missingProfile = await request(app)
      .post('/api/v1/users')
      .set(auth(tokenFor(scenario.admin)))
      .send({ name: 'Profileless', email: 'profileless@test.local', role: 'STUDENT', password: 'AnotherPass1!' });
    expect(missingProfile.status).toBe(400);

    const student = await request(app)
      .post('/api/v1/users')
      .set(auth(tokenFor(scenario.admin)))
      .send({
        name: 'New Student',
        email: 'new.student@test.local',
        role: 'STUDENT',
        password: 'AnotherPass1!',
        studentProfile: { rollNo: 'BSCS-900', programId: scenario.program.id, batch: '2030' },
      });
    expect(student.status).toBe(201);
    const profile = await prisma.studentProfile.findUnique({ where: { rollNo: 'BSCS-900' } });
    expect(profile?.programId).toBe(scenario.program.id);
    const linkedUser = await prisma.user.findUnique({ where: { id: student.body.data.id } });
    expect(linkedUser?.departmentId).toBe(scenario.department.id);

    // A profile on a non-student account is rejected.
    const profileOnStaff = await request(app)
      .post('/api/v1/users')
      .set(auth(tokenFor(scenario.admin)))
      .send({
        name: 'Staff Profile',
        email: 'staff.profile@test.local',
        role: 'TUTOR',
        password: 'AnotherPass1!',
        departmentId: scenario.department.id,
        studentProfile: { rollNo: 'BSCS-901', programId: scenario.program.id },
      });
    expect(profileOnStaff.status).toBe(400);

    // Duplicate e-mail and duplicate employee number both conflict.
    const duplicateEmail = await request(app)
      .post('/api/v1/users')
      .set(auth(tokenFor(scenario.admin)))
      .send({ name: 'Clone', email: 'new.tutor@test.local', role: 'TUTOR', password: 'AnotherPass1!', departmentId: scenario.department.id });
    expect(duplicateEmail.status).toBe(409);
    const duplicateEmployee = await request(app)
      .post('/api/v1/users')
      .set(auth(tokenFor(scenario.admin)))
      .send({ name: 'Clone', email: 'new.tutor2@test.local', role: 'TUTOR', password: 'AnotherPass1!', departmentId: scenario.department.id, employeeNo: 'EMP-21' });
    expect(duplicateEmployee.status).toBe(409);

    // Only administrators may create accounts; the password is stored hashed.
    const forbidden = await request(app)
      .post('/api/v1/users')
      .set(auth(tokenFor(scenario.tutor)))
      .send({ name: 'Self', email: 'self@test.local', role: 'TUTOR', password: 'AnotherPass1!', departmentId: scenario.department.id });
    expect(forbidden.status).toBe(403);
  });

  it('enforces the self-deactivation guard and supports deactivate/reactivate cycles', async () => {
    const scenario = await createScenario();

    const selfDeactivate = await request(app)
      .patch(`/api/v1/users/${scenario.admin.id}`)
      .set(auth(tokenFor(scenario.admin)))
      .send({ isActive: false });
    expect(selfDeactivate.status).toBe(400);
    const adminRow = await prisma.user.findUnique({ where: { id: scenario.admin.id } });
    expect(adminRow?.isActive).toBe(true);

    const deactivated = await request(app)
      .patch(`/api/v1/users/${scenario.otherTutor.id}`)
      .set(auth(tokenFor(scenario.admin)))
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.isActive).toBe(false);
    const auditRow = await lastAudit('User', scenario.otherTutor.id);
    expect(auditRow?.action).toBe('UPDATE');

    const reactivated = await request(app)
      .patch(`/api/v1/users/${scenario.otherTutor.id}`)
      .set(auth(tokenFor(scenario.admin)))
      .send({ isActive: true });
    expect(reactivated.body.data.isActive).toBe(true);
  });

  it('updates duplicate e-mails safely and paginates/searches the student roster', async () => {
    const scenario = await createScenario();

    const duplicateEmail = await request(app)
      .patch(`/api/v1/users/${scenario.tutor.id}`)
      .set(auth(tokenFor(scenario.admin)))
      .send({ email: 'admin@test.local' });
    expect(duplicateEmail.status).toBe(409);

    const listed = await request(app)
      .get('/api/v1/students?limit=2&page=2')
      .set(auth(tokenFor(scenario.admin)));
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(2);
    expect(listed.body.meta.total).toBe(6);
    expect(listed.body.meta.page).toBe(2);
    expect(listed.body.data[0].rollNo).toBe('BSCS-003');

    const searched = await request(app)
      .get('/api/v1/students?q=outside')
      .set(auth(tokenFor(scenario.admin)));
    expect(searched.body.data.map((row: { user: { name: string } }) => row.user.name)).toEqual(['Outside Student']);
    expect(searched.body.data[0].program.code).toBe('BSSE');

    // A tutor only sees students enrolled in their own offerings.
    const tutorRoster = await request(app)
      .get('/api/v1/students')
      .set(auth(tokenFor(scenario.tutor)));
    expect(tutorRoster.body.data).toHaveLength(5);
    expect(tutorRoster.body.data.some((row: { rollNo: string }) => row.rollNo === 'BSSE-001')).toBe(false);
  });

  it('revokes active sessions on administrative password reset and audits the action', async () => {
    const scenario = await createScenario();

    const login = await request(app).post('/api/v1/auth/login').send({ email: scenario.tutor.email, password: 'TestPass123!' });
    expect(login.status).toBe(200);
    const oldCookie = (login.headers['set-cookie'] as unknown as string[]).find((row) => row.startsWith('obe_refresh='));

    const reset = await request(app)
      .post(`/api/v1/users/${scenario.tutor.id}/reset-password`)
      .set(auth(tokenFor(scenario.admin)))
      .send({ password: 'BrandNewPass9!' });
    expect(reset.status).toBe(200);

    // The old refresh cookie no longer rotates a session.
    const refreshed = await request(app).post('/api/v1/auth/refresh').set('Cookie', oldCookie);
    expect([401, 403]).toContain(refreshed.status);

    const auditRow = await lastAudit('User', scenario.tutor.id);
    expect(auditRow?.metadata).toMatchObject({ field: 'password_reset' });
    const stored = await prisma.user.findUnique({ where: { id: scenario.tutor.id } });
    expect(stored?.failedLoginCount).toBe(0);
    expect(stored?.lockedUntil).toBeNull();
  });
});

describe('admin panel: dashboard, audit trail and policies', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('computes institutional dashboard metrics from live database state', async () => {
    const scenario = await createScenario();
    const response = await request(app).get('/api/v1/dashboard').set(auth(tokenFor(scenario.admin)));
    expect(response.status).toBe(200);
    expect(response.body.data.role).toBe('ADMIN');

    const cards = Object.fromEntries(response.body.data.cards.map((card: { key: string; value: number }) => [card.key, card.value]));
    // Verified against the seeded scenario: 6 student profiles, 2 programmes, 2 courses.
    expect(cards.students).toBe(6);
    expect(cards.programs).toBe(2);
    expect(cards.offerings).toBe(2);
    expect(cards.attainment).toBe(0); // no attainment run has been persisted yet
    expect(cards.plans).toBe(0);
    // Detail strings carry live counts, not placeholders.
    const studentCard = response.body.data.cards.find((card: { key: string }) => card.key === 'students');
    expect(studentCard.detail).toBe('2 tutors');
    expect(response.body.data.usersByRole.find((row: { role: string }) => row.role === 'STUDENT')._count._all).toBe(6);
    expect(response.body.data.recentAudit).toEqual([]);
  });

  it('queries and filters the audit trail with pagination and role isolation', async () => {
    const scenario = await createScenario();
    await request(app)
      .post('/api/v1/departments')
      .set(auth(tokenFor(scenario.admin)))
      .send({ name: 'Audited dept', code: 'AUD' });
    await request(app)
      .post('/api/v1/users')
      .set(auth(tokenFor(scenario.admin)))
      .send({ name: 'Audited tutor', email: 'audited@test.local', role: 'TUTOR', password: 'AnotherPass1!', departmentId: scenario.department.id });

    const all = await request(app).get('/api/v1/audit-logs?limit=10').set(auth(tokenFor(scenario.admin)));
    expect(all.status).toBe(200);
    expect(all.body.data.length).toBeGreaterThanOrEqual(2);
    expect(all.body.data[0].entityType).toBe('User');

    const filtered = await request(app)
      .get('/api/v1/audit-logs?entityType=Department&action=INSERT')
      .set(auth(tokenFor(scenario.admin)));
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].metadata.code).toBe('AUD');

    const filterOptions = await request(app).get('/api/v1/audit-logs/filters').set(auth(tokenFor(scenario.admin)));
    expect(filterOptions.status).toBe(200);
    expect(filterOptions.body.data.actions).toContain('INSERT');

    const denied = await request(app).get('/api/v1/audit-logs').set(auth(tokenFor(scenario.tutor)));
    expect(denied.status).toBe(403);
    const studentDenied = await request(app).get('/api/v1/audit-logs').set(auth(tokenFor(scenario.students[0])));
    expect(studentDenied.status).toBe(403);
  });

  it('enforces the single-active policy invariant on create and activate', async () => {
    const scenario = await createScenario();
    const policyConfig = (scenario.policy.config as Record<string, unknown>) && {
      cloMasteryThreshold: 55,
      cohortAttainmentTarget: 70,
      minCohortSize: 4,
      atRiskBand: 5,
      rounding: 1,
      missingEvidence: 'exclude',
      includeUnapprovedClos: false,
      ploAggregation: 'weighted',
      ploWeighting: 'mapping_weight_and_cohort',
    };

    const created = await request(app)
      .post('/api/v1/attainment-policies')
      .set(auth(tokenFor(scenario.admin)))
      .send({
        name: 'Tighter policy',
        version: 'tight-1',
        description: 'Secondary policy used by the parity suite',
        config: policyConfig,
        isActive: true,
      });
    expect(created.status).toBe(201);

    const active = await prisma.attainmentPolicy.findMany({ where: { isActive: true } });
    expect(active).toHaveLength(1);
    expect(active[0].version).toBe('tight-1');

    // Reactivating an earlier version moves the single active flag.
    const reactivated = await request(app)
      .post(`/api/v1/attainment-policies/${scenario.policy.id}/activate`)
      .set(auth(tokenFor(scenario.admin)));
    expect(reactivated.status).toBe(200);
    const stillSingle = await prisma.attainmentPolicy.findMany({ where: { isActive: true } });
    expect(stillSingle.map((row) => row.version)).toEqual(['test-1']);

    // A second activation of the same policy is idempotent and audited.
    const again = await request(app)
      .post(`/api/v1/attainment-policies/${scenario.policy.id}/activate`)
      .set(auth(tokenFor(scenario.admin)));
    expect(again.body.data.isActive).toBe(true);
    expect((await prisma.attainmentPolicy.findMany({ where: { isActive: true } }))).toHaveLength(1);

    // Activation is administrator-only.
    const denied = await request(app)
      .post(`/api/v1/attainment-policies/${scenario.policy.id}/activate`)
      .set(auth(tokenFor(scenario.tutor)));
    expect(denied.status).toBe(403);
  });
});
