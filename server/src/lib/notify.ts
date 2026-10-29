import type { NotificationType, Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

interface NotifyInput {
  userIds: string[];
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  tx?: Prisma.TransactionClient;
}

/**
 * Persist one notification per recipient. In-app delivery is the only channel
 * implemented, so a row that has been persisted is marked DELIVERED with a
 * timestamp. Email/push delivery must add its own state; it must not reuse
 * DELIVERED until the external channel confirms it.
 */
export async function notify(input: NotifyInput): Promise<number> {
  const recipients = [...new Set(input.userIds)].filter(Boolean);
  if (recipients.length === 0) return 0;
  const client = input.tx ?? prisma;

  const created = await client.notification.createManyAndReturn({
    data: recipients.map((userId) => ({
      userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
    })),
    select: { id: true },
  });

  const now = new Date();
  await client.notification.updateMany({
    where: { id: { in: created.map((row) => row.id) } },
    data: { deliveryStatus: 'DELIVERED', deliveredAt: now },
  });

  return created.length;
}
