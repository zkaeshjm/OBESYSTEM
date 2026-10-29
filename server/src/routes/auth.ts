import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/async-handler.js';
import { badRequest, unauthorized, forbidden, locked } from '../lib/errors.js';
import { verifyPassword } from '../lib/password.js';
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  createRefreshToken,
  hashRefreshToken,
  setRefreshCookie,
  signAccessToken,
} from '../lib/tokens.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { sendData } from '../lib/http.js';
import type { User } from '@prisma/client';

const router = Router();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    departmentId: user.departmentId,
    employeeNo: user.employeeNo,
    phone: user.phone,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
  };
}

function permissionsFor(role: User['role']) {
  return {
    manageUsers: role === 'ADMIN',
    manageAcademicStructure: role === 'ADMIN',
    manageProgramOutcomes: role === 'ADMIN',
    manageNotifications: role === 'ADMIN',
    viewAuditLog: role === 'ADMIN',
    authorClos: role === 'ADMIN' || role === 'TUTOR',
    approveClos: role === 'ADMIN',
    authorAssessments: role === 'ADMIN' || role === 'TUTOR',
    grade: role === 'ADMIN' || role === 'TUTOR',
    computeAttainment: role === 'ADMIN' || role === 'TUTOR',
    submitAssessments: role === 'STUDENT',
    viewReports: true,
  };
}

async function issueSession(
  user: User,
  meta: { userAgent?: string; ip?: string }
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
  const refresh = createRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: refresh.hash,
      expiresAt: refresh.expiresAt,
      userAgent: meta.userAgent?.slice(0, 500),
      ip: meta.ip,
    },
  });
  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role, email: user.email }),
    refreshToken: refresh.token,
    expiresAt: refresh.expiresAt,
  };
}

router.post(
  '/login',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    skip: () => env.NODE_ENV === 'test',
    message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again later.' } },
  }),
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      await audit(req, {
        action: 'LOGIN_FAILED',
        entityType: 'User',
        metadata: { email, reason: 'unknown_email' },
        actor: null,
      });
      throw unauthorized('Email or password is incorrect');
    }
    if (!user.isActive) throw forbidden('This account has been deactivated');
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw locked('Too many failed sign-in attempts. Try again later.');
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      const failed = user.failedLoginCount + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failed,
          lockedUntil:
            failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null,
        },
      });
      await audit(req, {
        action: 'LOGIN_FAILED',
        entityType: 'User',
        entityId: user.id,
        metadata: { email, reason: 'invalid_password' },
        actor: null,
      });
      throw unauthorized('Email or password is incorrect');
    }

    const fresh = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const session = await issueSession(fresh, {
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });
    setRefreshCookie(res, session.refreshToken, session.expiresAt);
    await audit(req, {
      action: 'LOGIN',
      entityType: 'User',
      entityId: fresh.id,
      actor: { id: fresh.id, email: fresh.email },
    });

    return sendData(res, {
      accessToken: session.accessToken,
      user: publicUser(fresh),
      permissions: permissionsFor(fresh.role),
    });
  })
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!token) throw unauthorized('No refresh session');

    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(token) },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || !stored.user.isActive) {
      clearRefreshCookie(res);
      throw unauthorized('Refresh session is no longer valid');
    }

    // Rotate: the old token is revoke-on-use, so a stolen copy stops working.
    const next = createRefreshToken();
    await prisma.$transaction([
      prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      }),
      prisma.refreshToken.create({
        data: {
          userId: stored.userId,
          tokenHash: next.hash,
          expiresAt: next.expiresAt,
          userAgent: req.get('user-agent')?.slice(0, 500),
          ip: req.ip,
        },
      }),
    ]);
    setRefreshCookie(res, next.token, next.expiresAt);

    return sendData(res, {
      accessToken: signAccessToken({
        sub: stored.user.id,
        role: stored.user.role,
        email: stored.user.email,
      }),
      user: publicUser(stored.user),
      permissions: permissionsFor(stored.user.role),
    });
  })
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (token) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashRefreshToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    clearRefreshCookie(res);
    return sendData(res, { ok: true });
  })
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        department: { select: { id: true, name: true, code: true } },
        studentProfile: {
          select: {
            id: true,
            rollNo: true,
            batch: true,
            program: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
    if (!user) throw unauthorized();
    return sendData(res, {
      user: { ...publicUser(user), department: user.department, studentProfile: user.studentProfile },
      permissions: permissionsFor(user.role),
    });
  })
);

// A tutor (or any authenticated user) may edit only their own harmless profile
// fields. Role, account status, permissions and assignments are deliberately
// not in the schema, so they cannot be changed through this endpoint.
router.patch(
  '/me',
  authenticate,
  validate(
    z.object({
      name: z.string().trim().min(2, 'Enter your full name').max(120).optional(),
      phone: z
        .string()
        .trim()
        .max(30)
        .regex(/^[0-9+()\-.\s]*$/, 'Use a valid phone number')
        .optional()
        .nullable(),
    })
  ),
  asyncHandler(async (req, res) => {
    const data: { name?: string; phone?: string | null } = {};
    if (req.body.name !== undefined) data.name = req.body.name;
    if (req.body.phone !== undefined) data.phone = req.body.phone || null;
    if (Object.keys(data).length === 0) throw badRequest('Nothing to update');

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data,
      include: { department: { select: { id: true, name: true, code: true } } },
    });
    await audit(req, {
      action: 'UPDATE',
      entityType: 'User',
      entityId: user.id,
      metadata: { fields: Object.keys(data), selfService: true },
    });
    return sendData(res, { user: { ...publicUser(user), department: user.department } });
  })
);

router.patch(
  '/password',
  authenticate,
  validate(
    z.object({
      currentPassword: z.string().min(1),
      newPassword: z
        .string()
        .min(10, 'Use at least 10 characters')
        .max(200)
        .regex(/[A-Za-z]/, 'Include a letter')
        .regex(/[0-9]/, 'Include a number'),
    })
  ),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw unauthorized();
    if (!(await verifyPassword(req.body.currentPassword, user.passwordHash))) {
      throw badRequest('Current password is incorrect');
    }
    const { hashPassword } = await import('../lib/password.js');
    const passwordHash = await hashPassword(req.body.newPassword);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    clearRefreshCookie(res);
    await audit(req, { action: 'UPDATE', entityType: 'User', entityId: user.id, metadata: { field: 'password' } });
    return sendData(res, { ok: true });
  })
);

export default router;
