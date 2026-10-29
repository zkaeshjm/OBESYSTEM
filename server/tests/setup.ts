import { afterAll } from 'vitest';
import { disconnectPrisma } from '../src/lib/prisma.js';

afterAll(async () => {
  await disconnectPrisma();
});
