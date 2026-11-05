import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/tests/engine.test.ts'],
    fileParallelism: false,
  },
});
