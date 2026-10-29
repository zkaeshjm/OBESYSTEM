import type { Request } from 'express';
import { prisma } from './prisma.js';

interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  actor?: { id: string; email: string } | null;
}

/**
 * Append-only audit write. Never record passwords, tokens, or full student
 * submissions; metadata is expected to contain identifiers and changed fields.
 */
export async function audit(req: Request, input: AuditInput): Promise<void> {
  const actor = input.actor ?? (req.user ? { id: req.user.id, email: req.user.email } : null);
  try {
    await prisma.auditLog.create({
      data: {
        actorId: actor?.id ?? null,
        actorEmail: actor?.email ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        ip: req.ip ?? null,
        userAgent: req.get('user-agent')?.slice(0, 500) ?? null,
        requestId: typeof req.id === 'string' ? req.id : null,
        metadata: (input.metadata ?? {}) as never,
      },
    });
  } catch (error) {
    // Audit failure must be visible in logs, but must not leak sensitive data.
    req.log?.error({ err: error, action: input.action, entityType: input.entityType }, 'audit write failed');
  }
}
