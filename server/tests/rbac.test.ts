import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { createAssessmentWithItems, createScenario, resetDb, submitAndGrade, tokenFor, TEST_PASSWORD } from './helpers.js';

const app = createApp();

describe('authentication', () => {
  beforeEach(async () => {
    await resetDb();
    await createScenario();
  });

  it('rejects an invalid password without revealing whether the email exists', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'tutor@test.local', password: 'wrong-password' });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    expect(response.body.error.message).toMatch(/incorrect/i);

    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@test.local', password: 'wrong-password' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(response.body.error.message);
  });

  it('issues an access token and httpOnly refresh cookie on valid login', async () => {
    const agent = request.agent(app);
    const response = await agent
      .post('/api/v1/auth/login')
      .send({ email: 'tutor@test.local', password: TEST_PASSWORD });
    expect(response.status).toBe(200);
    expect(response.body.data.user.role).toBe('TUTOR');
    expect(response.body.data.user.passwordHash).toBeUndefined();
    expect(response.body.data.accessToken).toBeTypeOf('string');
    const cookies = response.headers['set-cookie'] as unknown as string[];
    expect(cookies.join(';')).toMatch(/obe_refresh=/);
    expect(cookies.join(';')).toMatch(/HttpOnly/i);

    const me = await agent.get('/api/v1/auth/me').set('Authorization', `Bearer ${response.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe('tutor@test.local');
  });

  it('rotates the refresh token and rejects reuse of the previous one', async () => {
    const agent = request.agent(app);
    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.local', password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    const oldCookie = (login.headers['set-cookie'] as unknown as string[])[0].split(';')[0];

    const refreshed = await agent.post('/api/v1/auth/refresh');
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toBeTypeOf('string');

    const reuse = await request(app).post('/api/v1/auth/refresh').set('Cookie', oldCookie);
    expect(reuse.status).toBe(401);
  });

  it('requires a valid access token for protected routes', async () => {
    const missing = await request(app).get('/api/v1/courses');
    expect(missing.status).toBe(401);

    const tampered = await request(app).get('/api/v1/courses').set('Authorization', 'Bearer not-a-token');
    expect(tampered.status).toBe(401);
  });
});

describe('role-based access control and data isolation', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('prevents students from using staff endpoints', async () => {
    const scenario = await createScenario();
    const token = tokenFor(scenario.students[0]);
    expect(token).toBeTypeOf('string');
    const response = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('prevents tutors from reading another tutor offering', async () => {
    const scenario = await createScenario();
    const response = await request(app)
      .get(`/api/v1/offerings/${scenario.otherOffering.id}`)
      .set('Authorization', `Bearer ${tokenFor(scenario.tutor)}`);
    expect(response.status).toBe(403);

    const own = await request(app)
      .get(`/api/v1/offerings/${scenario.offering.id}`)
      .set('Authorization', `Bearer ${tokenFor(scenario.tutor)}`);
    expect(own.status).toBe(200);
  });

  it('prevents students from reading another offering or another student submission', async () => {
    const scenario = await createScenario();
    const assessment = await createAssessmentWithItems(scenario.offering.id, scenario.tutor.id, scenario.clo.id, {
      publish: true,
    });
    const submission = await submitAndGrade(
      assessment.id,
      scenario.students[1].studentProfile!.id,
      scenario.tutor.id,
      [0.9, 0.9]
    );

    const otherOffering = await request(app)
      .get(`/api/v1/offerings/${scenario.otherOffering.id}`)
      .set('Authorization', `Bearer ${tokenFor(scenario.students[0])}`);
    expect(otherOffering.status).toBe(403);

    const otherSubmission = await request(app)
      .get(`/api/v1/submissions/${submission.id}`)
      .set('Authorization', `Bearer ${tokenFor(scenario.students[0])}`);
    expect(otherSubmission.status).toBe(403);
  });

  it('scopes the course list to the viewer', async () => {
    const scenario = await createScenario();
    const tutorCourses = await request(app)
      .get('/api/v1/courses')
      .set('Authorization', `Bearer ${tokenFor(scenario.tutor)}`);
    expect(tutorCourses.status).toBe(200);
    expect(tutorCourses.body.data.map((course: { code: string }) => course.code)).toEqual(['CS-101']);

    const adminCourses = await request(app)
      .get('/api/v1/courses')
      .set('Authorization', `Bearer ${tokenFor(scenario.admin)}`);
    expect(adminCourses.body.data).toHaveLength(2);
  });

  it('scopes notifications to the recipient', async () => {
    const scenario = await createScenario();
    await prisma.notification.createMany({
      data: [
        { userId: scenario.students[0].id, type: 'SYSTEM', title: 'For student one', body: 'Body', deliveryStatus: 'DELIVERED', deliveredAt: new Date() },
        { userId: scenario.students[1].id, type: 'SYSTEM', title: 'For student two', body: 'Body', deliveryStatus: 'DELIVERED', deliveredAt: new Date() },
      ],
    });
    const mine = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${tokenFor(scenario.students[0])}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].title).toBe('For student one');

    const other = await prisma.notification.findFirstOrThrow({ where: { userId: scenario.students[1].id } });
    const attempt = await request(app)
      .patch(`/api/v1/notifications/${other.id}/read`)
      .set('Authorization', `Bearer ${tokenFor(scenario.students[0])}`);
    expect(attempt.status).toBe(404);
  });
});
