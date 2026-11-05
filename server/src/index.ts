import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { runDeadlineReminders } from './services/deadline-reminders.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, environment: env.NODE_ENV }, 'OBE API listening');
});

// Database-backed in-app reminders. Runs are idempotent by dedupe key.
const runReminders = () => {
  runDeadlineReminders()
    .then((result) => logger.info(result, 'deadline reminder job completed'))
    .catch((error) => logger.error({ err: error }, 'deadline reminder job failed'));
};
const reminderTimer = setInterval(runReminders, 6 * 60 * 60 * 1000);
setTimeout(runReminders, 30_000);

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  clearInterval(reminderTimer);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
