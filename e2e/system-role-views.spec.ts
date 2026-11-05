import { expect, test, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * System-wide console-error sweep across the three roles.
 *
 * Visits every route the signed-in role is allowed to render (plus one
 * offering detail reached the way the UI reaches it) and fails the test if
 * the browser logs a console error or an uncaught page error anywhere.
 * This is the "no silent runtime breakage" guarantee for the audit report.
 */

const ADMIN = ['admin@uiit.edu.pk', 'Admin123!'] as const;
const TUTOR = ['sara.malik@uiit.edu.pk', 'Tutor123!'] as const;
const STUDENT = ['bilal.ahmed@student.uiit.edu.pk', 'Student123!'] as const;

const ROUTES_BY_ROLE = {
  ADMIN: [
    '/',
    '/departments',
    '/programs',
    '/semesters',
    '/courses',
    '/offerings',
    '/plos',
    '/clo-plo-mapping',
    '/reports',
    '/users',
    '/audit',
    '/policies',
    '/notifications',
    '/profile',
    '/settings',
  ],
  TUTOR: [
    '/',
    '/courses',
    '/offerings',
    '/plos',
    '/clo-plo-mapping',
    '/reports',
    '/notifications',
    '/profile',
    '/settings',
  ],
  STUDENT: [
    '/',
    '/offerings',
    '/reports',
    '/notifications',
    '/profile',
    '/settings',
  ],
} as const;

async function login(page: Page, credentials: readonly [string, string]) {
  await page.goto('/login');
  await page.getByLabel('Official email').fill(credentials[0]);
  await page.getByLabel('Password').fill(credentials[1]);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(`[console.error] ${message.text()}`);
  });
  page.on('pageerror', (error: Error) => {
    errors.push(`[pageerror] ${error.message}`);
  });
  return errors;
}

for (const [role, credentials] of [
  ['ADMIN', ADMIN],
  ['TUTOR', TUTOR],
  ['STUDENT', STUDENT],
] as const) {
  test.describe(`console sweep: ${role}`, () => {
    test(`${role} renders every permitted route without console or page errors`, async ({ page }) => {
      await login(page, credentials);
      // Error collection starts after authentication: the anonymous login page
      // intentionally probes /auth/refresh and /auth/me, and the resulting
      // handled 401 responses are logged by Chromium as resource errors on
      // every fresh browser context (cookie-based session restore noise).
      const errors = collectErrors(page);

      for (const route of ROUTES_BY_ROLE[role]) {
        await page.goto(route);
        // A signed-in session must never fall back to the login page.
        await expect(page).not.toHaveURL(/\/login/);
        await expect(page.locator('header, nav, main').first()).toBeVisible();
      }

      // One offering detail per role, reached the way the UI reaches it.
      await page.goto('/offerings');
      const firstOfferingHref = await page
        .locator('a[href^="/offerings/"]')
        .first()
        .getAttribute('href')
        .catch(() => null);
      if (firstOfferingHref) {
        await page.goto(firstOfferingHref);
        await expect(page).not.toHaveURL(/\/login/);
      }

      expect(errors, `runtime errors on ${role} routes:\n${errors.join('\n')}`).toEqual([]);
    });
  });
}
