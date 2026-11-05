import { beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { hashRefreshToken } from '../src/lib/tokens.js';
import { createScenario, resetDb, tokenFor, TEST_PASSWORD } from './helpers.js';

const app = createApp();

/** Signs a token with the real secret/claims but an explicit expiry string. */
function signedToken(
  user: { id: string; role: string; email: string },
  expiresIn: string,
  secret: string = env.JWT_ACCESS_SECRET,
) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, secret, {
    expiresIn,
    issuer: 'obe-system',
    audience: 'obe-client',
  });
}

/** Creates a refresh token row and returns its raw cookie value. */
async function refreshCookieToken(userId: string, expiresAt: Date) {
  const token = `stale-refresh-${userId}`;
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashRefreshToken(token), expiresAt },
  });
  return token;
}

describe('access-token lifecycle', () => {
  beforeEach(resetDb);

  it('rejects an expired access token', async () => {
    const scenario = await createScenario();
    const expired = signedToken(scenario.tutor, '-1s');
    const response = await request(app).get('/api/v1/courses').set('Authorization', `Bearer ${expired}`);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    expect(response.body.error.message).toMatch(/invalid or expired/i);
  });

  it('rejects an access token whose signature was tampered with', async () => {
    const scenario = await createScenario();
    const valid = tokenFor(scenario.tutor);
    const [header, payload, signature] = valid.split('.');
    const wrongSecretToken = signedToken(
      { id: scenario.tutor.id, role: 'ADMIN', email: scenario.tutor.email },
      '1h',
      'attacker-controlled-secret',
    );
    expect(wrongSecretToken).not.toBe(valid);

    for (const token of [`${header}.${payload}.${signature.slice(0, -2)}xx`, wrongSecretToken]) {
      const response = await request(app).get('/api/v1/courses').set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(401);
    }
  });

  it('stops honouring the token of a deactivated user even though the signature is valid', async () => {
    const scenario = await createScenario();
    const token = tokenFor(scenario.tutor);
    const before = await request(app).get('/api/v1/courses').set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);

    await prisma.user.update({ where: { id: scenario.tutor.id }, data: { isActive: false } });
    const after = await request(app).get('/api/v1/courses').set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
    expect(after.body.error.message).toMatch(/not active/i);
  });

  it('rejects the token of a locked-out user', async () => {
    const scenario = await createScenario();
    const token = tokenFor(scenario.tutor);
    await prisma.user.update({
      where: { id: scenario.tutor.id },
      data: { failedLoginCount: 5, lockedUntil: new Date(Date.now() + 15 * 60 * 1000) },
    });
    const response = await request(app).get('/api/v1/courses').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(401);
    expect(response.body.error.message).toMatch(/locked/i);
  });

  it('resolves role and authorization from the database, not the token claims', async () => {
    const scenario = await createScenario();
    // Token still claims STUDENT, but the database now says TUTOR.
    const promoted = await prisma.user.update({
      where: { id: scenario.students[0].id },
      data: { role: 'TUTOR' },
    });
    const promotedResponse = await request(app)
      .get('/api/v1/offerings')
      .set('Authorization', `Bearer ${tokenFor(scenario.students[0])}`);
    // The DB role (TUTOR) governs the endpoint result — this token would show
    // all offerings if middleware trusted the stale STUDENT claim.
    expect(promotedResponse.status).toBe(200);
    // The tutor-scoped list reflects the database role: this user owns no
    // offering, so every offering is hidden.
    expect(promotedResponse.body.data).toHaveLength(0);
    expect(promoted.role).toBe('TUTOR');

    // Inverse direction: a token signed while TUTOR, demoted in the DB, may not
    // use tutor authorization claims.
    await prisma.user.update({ where: { id: scenario.tutor.id }, data: { role: 'STUDENT' } });
    const demoted = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${tokenFor(scenario.tutor)}`);
    expect(demoted.status).toBe(403);
  });
});

describe('login lockout', () => {
  beforeEach(resetDb);

  it('locks the account after five failed attempts and refuses correct credentials until expiry', async () => {
    const scenario = await createScenario();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await request(app).post('/api/v1/auth/login').send({
        email: scenario.tutor.email,
        password: 'definitely-wrong',
      });
      expect(failed.status).toBe(401);
      expect(failed.body.error.code).toBe('UNAUTHENTICATED');
    }

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: scenario.tutor.email } });
    expect(stored.failedLoginCount).toBe(5);
    expect(stored.lockedUntil).not.toBeNull();

    const locked = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: scenario.tutor.email, password: TEST_PASSWORD });
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('LOCKED');

    await prisma.user.update({
      where: { id: stored.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    const recovered = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: scenario.tutor.email, password: TEST_PASSWORD });
    expect(recovered.status).toBe(200);

    const reset = await prisma.user.findUniqueOrThrow({ where: { email: scenario.tutor.email } });
    expect(reset.failedLoginCount).toBe(0);
    expect(reset.lockedUntil).toBeNull();
  });
});

describe('refresh-token lifecycle', () => {
  beforeEach(resetDb);

  it('refuses an expired refresh token and issues no new session', async () => {
    const scenario = await createScenario();
    const token = await refreshCookieToken(scenario.tutor.id, new Date(Date.now() - 1000));

    const response = await request(app).post('/api/v1/auth/refresh').set('Cookie', `obe_refresh=${token}`);
    expect(response.status).toBe(401);

    const remaining = await prisma.refreshToken.count({ where: { userId: scenario.tutor.id } });
    expect(remaining).toBe(1); // nothing rotated or deleted on the expired path
  });

  it('refuses an unknown refresh token outright', async () => {
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'obe_refresh=nonsense-token-do-not-match');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });
});

/* ------------------------- admin enrollment workflow ------------------------- */

describe('admin enrollment management (Workflow B surface)', () => {
  beforeEach(resetDb);

  it('enrols a student by a tutor-facing offering endpoint only for admins, audits and notifies', async () => {
    const scenario = await createScenario();
    const target = scenario.students[0]; // enrolled in scenario.offering, not in otherOffering

    const asTutor = await request(app)
      .post(`/api/v1/offerings/${scenario.otherOffering.id}/enrollments`)
      .set('Authorization', `Bearer ${tokenFor(scenario.tutor)}`)
      .send({ studentIds: [target.studentProfile!.id] });
    expect(asTutor.status).toBe(403);

    const asStudent = await request(app)
      .post(`/api/v1/offerings/${scenario.otherOffering.id}/enrollments`)
      .set('Authorization', `Bearer ${tokenFor(scenario.students[1])}`)
      .send({ studentIds: [target.studentProfile!.id] });
    expect(asStudent.status).toBe(403);

    const asAdmin = await request(app)
      .post(`/api/v1/offerings/${scenario.otherOffering.id}/enrollments`)
      .set('Authorization', `Bearer ${tokenFor(scenario.admin)}`)
      .send({ studentIds: [target.studentProfile!.id] });
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.data).toEqual({ enrolled: 1 });

    const enrollment = await prisma.enrollment.findFirstOrThrow({
      where: { offeringId: scenario.otherOffering.id, studentId: target.studentProfile!.id },
    });
    expect(enrollment.status).toBe('ENROLLED');

    const auditRow = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'Enrollment' } });
    expect(auditRow.action).toBe('INSERT');

    const notified = await prisma.notification.findFirst({
      where: { userId: target.id, type: 'ENROLLMENT_CHANGED' },
    });
    expect(notified).not.toBeNull();
  });

  it('rejects an enrollment request containing an unknown or inactive student', async () => {
    const scenario = await createScenario();
    const response = await request(app)
      .post(`/api/v1/offerings/${scenario.otherOffering.id}/enrollments`)
      .set('Authorization', `Bearer ${tokenFor(scenario.admin)}`)
      .send({ studentIds: ['11111111-1111-4111-8111-111111111111'] });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toMatch(/do not exist or are inactive/i);

    await prisma.user.update({ where: { id: scenario.students[2].id }, data: { isActive: false } });
    const inactive = await request(app)
      .post(`/api/v1/offerings/${scenario.otherOffering.id}/enrollments`)
      .set('Authorization', `Bearer ${tokenFor(scenario.admin)}`)
      .send({ studentIds: [scenario.students[2].studentProfile!.id] });
    expect(inactive.status).toBe(400);
  });

  it('updates an enrollment status and notifies, but only via admin', async () => {
    const scenario = await createScenario();
    const enrollment = await prisma.enrollment.findFirstOrThrow({
      where: { offeringId: scenario.offering.id, studentId: scenario.students[0].studentProfile!.id },
    });

    const asTutor = await request(app)
      .patch(`/api/v1/enrollments/${enrollment.id}`)
      .set('Authorization', `Bearer ${tokenFor(scenario.tutor)}`)
      .send({ status: 'DROPPED' });
    expect(asTutor.status).toBe(403);

    const asAdmin = await request(app)
      .patch(`/api/v1/enrollments/${enrollment.id}`)
      .set('Authorization', `Bearer ${tokenFor(scenario.admin)}`)
      .send({ status: 'WITHDRAWN' });
    expect(asAdmin.status).toBe(200);
    const updated = await prisma.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
    expect(updated.status).toBe('WITHDRAWN');

    const auditRow = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'Enrollment', entityId: enrollment.id, action: 'UPDATE' },
    });
    expect(auditRow.metadata).toMatchObject({ from: 'ENROLLED', to: 'WITHDRAWN' });

    const studentUser = await prisma.user.findUniqueOrThrow({ where: { id: scenario.students[0].id } });
    const notified = await prisma.notification.findFirst({
      where: { userId: studentUser.id, type: 'ENROLLMENT_CHANGED' },
    });
    expect(notified).not.toBeNull();
  });

  it('keeps enrollment history when a student is deactivated (soft-deactivation)', async () => {
    const scenario = await createScenario();
    const enrollment = await prisma.enrollment.findFirstOrThrow({
      where: { offeringId: scenario.offering.id, studentId: scenario.students[0].studentProfile!.id },
    });

    await prisma.user.update({ where: { id: scenario.students[0].id }, data: { isActive: false } });

    const stillThere = await prisma.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
    expect(stillThere.status).toBe('ENROLLED');

    // The deactivated student cannot keep requesting academic data.
    const response = await request(app)
      .get('/api/v1/offerings')
      .set('Authorization', `Bearer ${tokenFor(scenario.students[0])}`);
    expect(response.status).toBe(401);
  });
});
