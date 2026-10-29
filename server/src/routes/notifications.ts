import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/async-handler.js';
import { badRequest, notFound } from '../lib/errors.js';
import { validate } from '../middleware/validate.js';
import { adminOnly, authenticate, requireRole } from '../middleware/auth.js';
import { sendData, readPagination } from '../lib/http.js';
import { notify } from '../lib/notify.js';
import { audit } from '../lib/audit.js';
import { runDeadlineReminders } from '../services/deadline-reminders.js';

const router = Router();
router.use(authenticate);

router.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const pagination = readPagination(req.query as Record<string, unknown>, 50);
    const unreadOnly = req.query.unreadOnly === 'true';
    const where = {
      userId: req.user!.id,
      ...(unreadOnly ? { readAt: null } : {}),
    };
    const [rows, total, unread] = await prisma.$transaction([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }),
    ]);
    return sendData(res, rows, {
      meta: { page: pagination.page, limit: pagination.limit, total, unread },
    });
  })
);

router.get(
  '/notifications/unread-count',
  asyncHandler(async (req, res) => {
    const unread = await prisma.notification.count({ where: { userId: req.user!.id, readAt: null } });
    return sendData(res, { unread });
  })
);

router.patch(
  '/notifications/:id/read',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.notification.findUnique({ where: { id: String(req.params.id) } });
    if (!existing || existing.userId !== req.user!.id) throw notFound('Notification');
    const row = await prisma.notification.update({
      where: { id: existing.id },
      data: { readAt: existing.readAt ?? new Date() },
    });
    return sendData(res, row);
  })
);

router.post(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    return sendData(res, { updated: result.count });
  })
);

router.post(
  '/notifications',
  adminOnly,
  validate(
    z
      .object({
        userIds: z.array(z.string().uuid()).max(500).optional(),
        role: z.enum(['ADMIN', 'TUTOR', 'STUDENT']).optional(),
        title: z.string().trim().min(3).max(160),
        body: z.string().trim().min(3).max(2000),
        link: z.string().trim().max(500).optional(),
      })
      .refine((value) => Boolean(value.userIds?.length || value.role), {
        message: 'Provide recipients or a role',
      })
  ),
  asyncHandler(async (req, res) => {
    const recipients = req.body.userIds?.length
      ? await prisma.user.findMany({
          where: { id: { in: req.body.userIds }, isActive: true },
          select: { id: true },
        })
      : await prisma.user.findMany({
          where: { role: req.body.role, isActive: true },
          select: { id: true },
        });
    if (recipients.length === 0) throw badRequest('No active recipients matched');
    await notify({
      userIds: recipients.map((recipient) => recipient.id),
      type: 'SYSTEM',
      title: req.body.title,
      body: req.body.body,
      link: req.body.link,
    });
    await audit(req, {
      action: 'INSERT',
      entityType: 'Notification',
      metadata: { recipients: recipients.length, role: req.body.role ?? null },
    });
    return sendData(res, { sent: recipients.length }, { status: 201 });
  })
);

router.post(
  '/notifications/run-deadline-reminders',
  requireRole('ADMIN', 'TUTOR'),
  asyncHandler(async (req, res) => {
    const result = await runDeadlineReminders(req.user!.role === 'TUTOR' ? req.user!.id : undefined);
    await audit(req, { action: 'INSERT', entityType: 'Notification', metadata: { job: 'deadline_reminders', ...result } });
    return sendData(res, result);
  })
);

export default router;
