import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/async-handler.js';
import { badRequest, unauthorized, forbidden, locked, conflict } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { notify } from '../lib/notify.js';
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
import { Prisma } from '@prisma/client';

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

const registrationPassword = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200)
  .regex(/[A-Za-z]/, 'Include a letter')
  .regex(/[0-9]/, 'Include a number');

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(160),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['TUTOR', 'STUDENT']),
  password: registrationPassword,
  departmentId: z.string().uuid().optional().nullable(),
  employeeNo: z.string().trim().max(40).optional().nullable(),
  rollNo: z.string().trim().min(1).max(40).optional().nullable(),
  programId: z.string().uuid().optional().nullable(),
  batch: z.string().trim().max(20).optional().nullable(),
});

const PUBLIC_REGISTRATION_RATE_LIMIT = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: () => env.NODE_ENV === 'test',
  message: { error: { code: 'RATE_LIMITED', message: 'Too many access requests from this network. Try again later.' } },
});

/**
 * Reference data the public sign-up form needs (active departments and
 * programmes). It exposes nothing beyond what the form must display: no user,
 * role or enrolment data is returned.
 */
router.get(
  '/register/options',
  PUBLIC_REGISTRATION_RATE_LIMIT,
  asyncHandler(async (_req, res) => {
    const [departments, programs] = await Promise.all([
      prisma.department.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
      prisma.program.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true, departmentId: true },
        orderBy: { code: 'asc' },
      }),
    ]);
    return sendData(res, { departments, programs });
  })
);

/**
 * Public tutor/student sign-up. A request is stored, never an account: no
 * session is issued and the applicant cannot sign in until an administrator
 * approves the request. Duplicate open applications are refused so a single
 * address cannot queue multiple requests.
 */
router.post(
  '/register',
  PUBLIC_REGISTRATION_RATE_LIMIT,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof registerSchema>;
    const email = body.email;

    const [existingUser, pendingRequest] = await Promise.all([
      prisma.user.findUnique({ where: { email }, select: { id: true } }),
      prisma.registrationRequest.findFirst({
        where: { email, status: 'PENDING' },
        select: { id: true, createdAt: true },
      }),
    ]);

    if (existingUser) {
      throw conflict('An account already exists for this email address. Sign in instead.');
    }
    if (pendingRequest) {
      throw conflict(
        'An application for this email is already awaiting approval. You cannot register again until an administrator reviews it.'
      );
    }

    let departmentId = body.departmentId ?? null;
    let rollNo: string | null = null;
    let programId: string | null = null;
    let batch: string | null = null;
    let employeeNo: string | null = null;

    if (body.role === 'TUTOR') {
      if (!departmentId) throw badRequest('Select the department you teach in');
      const department = await prisma.department.findFirst({
        where: { id: departmentId, isActive: true },
        select: { id: true },
      });
      if (!department) throw badRequest('Select an active department');
      employeeNo = body.employeeNo?.trim() || null;
    } else {
      rollNo = body.rollNo?.trim() || null;
      programId = body.programId ?? null;
      if (!rollNo) throw badRequest('Enter your roll number');
      if (!programId) throw badRequest('Select your programme');
      const program = await prisma.program.findFirst({
        where: { id: programId, isActive: true },
        select: { id: true, departmentId: true },
      });
      if (!program) throw badRequest('Select an active programme');
      departmentId = program.departmentId;
      batch = body.batch?.trim() || null;

      const [existingProfile, pendingRollNo] = await Promise.all([
        prisma.studentProfile.findUnique({ where: { rollNo }, select: { id: true } }),
        prisma.registrationRequest.findFirst({
          where: { rollNo, status: 'PENDING' },
          select: { id: true },
        }),
      ]);
      if (existingProfile) throw conflict('That roll number is already registered.');
      if (pendingRollNo) {
        throw conflict('An application with this roll number is already awaiting approval.');
      }
    }

    const passwordHash = await hashPassword(body.password);
    let request;
    try {
      request = await prisma.registrationRequest.create({
        data: {
          name: body.name,
          email,
          passwordHash,
          role: body.role,
          departmentId,
          employeeNo,
          rollNo,
          programId,
          batch,
        },
        select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
      });
    } catch (error) {
      // The partial unique index on pending email applications is the last
      // line of defence against two simultaneous submissions.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('An application for this email is already awaiting approval.');
      }
      throw error;
    }

    await audit(req, {
      action: 'REGISTRATION_SUBMITTED',
      entityType: 'RegistrationRequest',
      entityId: request.id,
      metadata: { email, role: request.role },
      actor: null,
    });

    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true },
      select: { id: true },
    });
    await notify({
      userIds: admins.map((admin) => admin.id),
      type: 'SYSTEM',
      title: 'New access request',
      body: `${request.name} (${request.role.toLowerCase()}) requested an account. Approval is required.`,
      link: '/registration-requests',
    });

    return sendData(
      res,
      {
        request: { id: request.id, email: request.email, role: request.role, status: request.status },
        message:
          'Your request was submitted. An administrator must approve it before you can sign in.',
      },
      { status: 201 }
    );
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
