import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { createScenario, resetDb, tokenFor, TEST_PASSWORD } from './helpers.js';

const app = createApp();

async function registrationPayload(overrides: Record<string, unknown> = {}) {
  const department = await prisma.department.findFirstOrThrow();
  return {
    name: 'Sana Iqbal',
    email: 'sana.iqbal@uiit.edu.pk',
    role: 'TUTOR',
    password: 'Applicant123!',
    departmentId: department.id,
    ...overrides,
  };
}

describe('self-service registration with administrator approval', () => {
  beforeEach(resetDb);

  it('stores a request, issues no session, and never creates an account', async () => {
    const department = await prisma.department.create({ data: { name: 'Computing', code: 'CMP' } });
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(await registrationPayload({ departmentId: department.id }));

    expect(response.status).toBe(201);
    expect(response.body.data.request.status).toBe('PENDING');
    expect(response.body.data.accessToken).toBeUndefined();

    expect(await prisma.user.count({ where: { email: 'sana.iqbal@uiit.edu.pk' } })).toBe(0);
    const stored = await prisma.registrationRequest.findFirstOrThrow();
    expect(stored.status).toBe('PENDING');
    expect(stored.passwordHash).not.toBe('Applicant123!');

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sana.iqbal@uiit.edu.pk', password: 'Applicant123!' });
    expect(login.status).toBe(401);
  });

  it('refuses a second application while one is pending', async () => {
    const department = await prisma.department.create({ data: { name: 'Computing', code: 'CMP' } });
    const payload = await registrationPayload({ departmentId: department.id });

    expect((await request(app).post('/api/v1/auth/register').send(payload)).status).toBe(201);
    const duplicate = await request(app).post('/api/v1/auth/register').send(payload);

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.message).toMatch(/already awaiting approval/i);
    expect(await prisma.registrationRequest.count()).toBe(1);
  });

  it('refuses an email that already belongs to an account', async () => {
    const scenario = await createScenario();
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(await registrationPayload({ email: scenario.tutor.email }));

    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/account already exists/i);
  });

  it('rejects administrator self-sign-up', async () => {
    const department = await prisma.department.create({ data: { name: 'Computing', code: 'CMP' } });
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(await registrationPayload({ role: 'ADMIN', departmentId: department.id }));

    expect(response.status).toBe(400);
    expect(await prisma.registrationRequest.count()).toBe(0);
  });

  it('lets an administrator approve a request into a usable account', async () => {
    const scenario = await createScenario();
    const department = await prisma.department.create({ data: { name: 'Computing', code: 'CMP' } });
    await request(app)
      .post('/api/v1/auth/register')
      .send(await registrationPayload({ departmentId: department.id }));
    const pending = await prisma.registrationRequest.findFirstOrThrow();

    const approve = await request(app)
      .post(`/api/v1/registration-requests/${pending.id}/approve`)
      .set('Authorization', `Bearer ${tokenFor(scenario.admin)}`);
    expect(approve.status).toBe(200);

    const created = await prisma.user.findUniqueOrThrow({ where: { email: 'sana.iqbal@uiit.edu.pk' } });
    expect(created.role).toBe('TUTOR');
    expect(created.isActive).toBe(true);
    expect(created.departmentId).toBe(department.id);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sana.iqbal@uiit.edu.pk', password: 'Applicant123!' });
    expect(login.status).toBe(200);

    const reviewed = await prisma.registrationRequest.findUniqueOrThrow({ where: { id: pending.id } });
    expect(reviewed.status).toBe('APPROVED');
    expect(reviewed.createdUserId).toBe(created.id);
    expect(reviewed.reviewedById).toBe(scenario.admin.id);

    // A reviewed request cannot be approved twice.
    const again = await request(app)
      .post(`/api/v1/registration-requests/${pending.id}/approve`)
      .set('Authorization', `Bearer ${tokenFor(scenario.admin)}`);
    expect(again.status).toBe(409);
  });

  it('rejects a request with a reason and never creates an account', async () => {
    const scenario = await createScenario();
    const department = await prisma.department.create({ data: { name: 'Computing', code: 'CMP' } });
    await request(app)
      .post('/api/v1/auth/register')
      .send(await registrationPayload({ departmentId: department.id }));
    const pending = await prisma.registrationRequest.findFirstOrThrow();

    const reject = await request(app)
      .post(`/api/v1/registration-requests/${pending.id}/reject`)
      .set('Authorization', `Bearer ${tokenFor(scenario.admin)}`)
      .send({ reason: 'Not on the departmental staff list' });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe('REJECTED');
    expect(reject.body.data.decisionNote).toBe('Not on the departmental staff list');

    expect(await prisma.user.count({ where: { email: 'sana.iqbal@uiit.edu.pk' } })).toBe(0);

    // A rejected application no longer blocks a fresh one.
    const retry = await request(app)
      .post('/api/v1/auth/register')
      .send(await registrationPayload({ departmentId: department.id }));
    expect(retry.status).toBe(201);
  });

  it('keeps the review queue administrator-only', async () => {
    const scenario = await createScenario();
    for (const actor of [scenario.tutor, scenario.students[0]]) {
      const response = await request(app)
        .get('/api/v1/registration-requests')
        .set('Authorization', `Bearer ${tokenFor(actor)}`);
      expect(response.status).toBe(403);
    }
    const anonymous = await request(app).get('/api/v1/registration-requests');
    expect(anonymous.status).toBe(401);
  });

  it('creates a student profile when a student request is approved', async () => {
    const scenario = await createScenario();
    const program = await prisma.program.findFirstOrThrow();
    await request(app).post('/api/v1/auth/register').send({
      name: 'Hamza Ali',
      email: 'hamza.ali@student.uiit.edu.pk',
      role: 'STUDENT',
      password: 'Applicant123!',
      rollNo: 'BSCS-21-099',
      programId: program.id,
      batch: '2021-2025',
    });
    const pending = await prisma.registrationRequest.findFirstOrThrow();

    const approve = await request(app)
      .post(`/api/v1/registration-requests/${pending.id}/approve`)
      .set('Authorization', `Bearer ${tokenFor(scenario.admin)}`);
    expect(approve.status).toBe(200);

    const profile = await prisma.studentProfile.findUniqueOrThrow({ where: { rollNo: 'BSCS-21-099' } });
    expect(profile.programId).toBe(program.id);
    expect(profile.batch).toBe('2021-2025');

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'hamza.ali@student.uiit.edu.pk', password: TEST_PASSWORD });
    expect(login.status).toBe(401); // approved student keeps the password they chose
  });
});
