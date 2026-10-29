import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/async-handler.js';
import { validate } from '../middleware/validate.js';
import { adminOnly, authenticate } from '../middleware/auth.js';
import { readPagination, sendPaginated } from '../lib/http.js';

const router = Router();

const filterSchema = z.object({
  action: z.string().trim().max(40).optional(),
  entityType: z.string().trim().max(60).optional(),
  actorId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(120).optional(),
});

router.get(
  '/audit-logs',
  authenticate,
  adminOnly,
  validate(filterSchema, 'query'),
  asyncHandler(async (req, res) => {
    const filters = req.query as unknown as z.infer<typeof filterSchema>;
    const pagination = readPagination(req.query as Record<string, unknown>, 100);
    const where = {
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(filters.from || filters.to
        ? {
            occurredAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
      ...(filters.q
        ? {
            OR: [
              { entityType: { contains: filters.q, mode: 'insensitive' as const } },
              { actorEmail: { contains: filters.q, mode: 'insensitive' as const } },
              { entityId: { contains: filters.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, name: true, role: true } } },
        orderBy: { occurredAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.auditLog.count({ where }),
    ]);
    return sendPaginated(res, rows, pagination, total);
  })
);

router.get(
  '/audit-logs/filters',
  authenticate,
  adminOnly,
  asyncHandler(async (_req, res) => {
    const [actions, entityTypes] = await prisma.$transaction([
      prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
      prisma.auditLog.findMany({ distinct: ['entityType'], select: { entityType: true }, orderBy: { entityType: 'asc' } }),
    ]);
    return res.json({
      data: {
        actions: actions.map((row) => row.action),
        entityTypes: entityTypes.map((row) => row.entityType),
      },
      meta: { requestId: res.locals.requestId },
    });
  })
);

export default router;
