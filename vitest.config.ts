import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/tests/**/*.test.ts'],
    globalSetup: ['server/tests/global-setup.ts'],
    setupFiles: ['server/tests/setup.ts'],
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/obe_test?schema=public',
      JWT_ACCESS_SECRET: 'test-only-secret-at-least-32-characters-long',
      LOG_LEVEL: 'silent',
    },
  },
});
