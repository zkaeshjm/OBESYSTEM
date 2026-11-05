import { defineConfig, devices } from '@playwright/test';

const e2eDatabaseUrl = 'postgresql://postgres:postgres@localhost:5433/obe_e2e?schema=public';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never' }], // review with: npx playwright show-report
  ],
  use: {
    baseURL: 'http://localhost:5173',
    // Run headed in the real installed Google Chrome so every step is visible
    // on screen. Override for CI with: PW_HEADLESS=1 PW_CHANNEL=chromium
    headless: process.env.PW_HEADLESS === '1',
    channel: process.env.PW_CHANNEL ?? 'chrome',
    viewport: { width: 1440, height: 900 },
    launchOptions: { slowMo: 150 }, // small pause between actions keeps runs easy to follow
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: { mode: 'retain-on-failure', size: { width: 1280, height: 720 } },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev:server',
      url: 'http://localhost:4000/api/v1/health',
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        DATABASE_URL: e2eDatabaseUrl,
        JWT_ACCESS_SECRET: 'e2e-only-secret-at-least-32-characters-long',
        CLIENT_ORIGIN: 'http://localhost:5173',
        PORT: '4000',
      },
    },
    {
      command: 'npm run dev:web',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
