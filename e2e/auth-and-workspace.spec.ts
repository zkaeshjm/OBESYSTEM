import { expect, test, type Page } from '@playwright/test';

/**
 * Authentication, navigation guard and workspace-page coverage.
 *
 * These flows complement critical-flows.spec.ts: they exercise the login
 * failure path, session persistence, sign-out, the URL-level role guards,
 * the 404 route and the seeded structure/account workspace pages that no
 * other spec visits (departments, semesters, notifications, profile,
 * settings, CLO–PLO mapping).
 */

const ADMIN = ['admin@uiit.edu.pk', 'Admin123!'] as const;
const TUTOR = ['sara.malik@uiit.edu.pk', 'Tutor123!'] as const;
const STUDENT = ['bilal.ahmed@student.uiit.edu.pk', 'Student123!'] as const;

async function login(page: Page, credentials: readonly [string, string]) {
  await page.goto('/login');
  await page.getByLabel('Official email').fill(credentials[0]);
  await page.getByLabel('Password').fill(credentials[1]);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
}

async function signOutFromAccountMenu(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: /Sign out/i }).click();
  await expect(page).toHaveURL(/\/login/);
}

test.describe('authentication', () => {
  test('rejects invalid credentials with a visible error and keeps the user on the login page', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Official email').fill(TUTOR[0]);
    await page.getByLabel('Password').fill('WrongPassword1!');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByRole('alert')).toContainText('Email or password is incorrect');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('redirects anonymous visitors from protected routes to the login page', async ({ page }) => {
    await page.goto('/offerings');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel('Official email')).toBeVisible();
  });

  test('keeps the session alive across a full page reload and ends it on sign out', async ({ page }) => {
    await login(page, TUTOR);

    // httpOnly refresh cookie must restore the session after a hard reload.
    await page.reload();
    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();

    await signOutFromAccountMenu(page);
    // Every protected route must bounce back to login once signed out.
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('navigation guards and unknown routes', () => {
  test('shows a friendly not-found page with a working way back', async ({ page }) => {
    await login(page, STUDENT);
    await page.goto('/this-route-does-not-exist');

    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to dashboard' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
  });

  test('students cannot reach administrator pages by editing the URL', async ({ page }) => {
    await login(page, STUDENT);

    for (const adminPath of ['/audit', '/departments', '/users']) {
      await page.goto(adminPath);
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
    }
  });
});

test.describe('administrator structure workspace', () => {
  test('departments, programmes and academic sessions render the seeded records', async ({ page }) => {
    await login(page, ADMIN);

    await page.getByRole('link', { name: 'Departments' }).click();
    await expect(page.getByRole('heading', { name: 'Departments' })).toBeVisible();
    await expect(page.getByText('University Institute of Information Technology').first()).toBeVisible();

    await page.getByRole('link', { name: 'Programmes' }).click();
    await expect(page.getByRole('heading', { name: 'Academic programmes' })).toBeVisible();
    await expect(page.getByText('BS Software Engineering').first()).toBeVisible();

    await page.getByRole('link', { name: 'Academic sessions' }).click();
    await expect(page.getByRole('heading', { name: 'Academic sessions' })).toBeVisible();
    await expect(page.getByText('Spring 2026').first()).toBeVisible();
  });
});

test.describe('account workspace', () => {
  test('profile shows the signed-in tutor and their editable details', async ({ page }) => {
    await login(page, TUTOR);
    await page.getByRole('link', { name: 'Profile' }).click();

    await expect(page.getByRole('heading', { name: 'Tutor profile' })).toBeVisible();
    await expect(page.getByText(TUTOR[0]).first()).toBeVisible();
    await expect(page.getByLabel('Display name')).toHaveValue('Dr. Sara Malik');
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
  });

  test('notifications page lists persisted delivery state', async ({ page }) => {
    await login(page, STUDENT);
    await page.getByRole('link', { name: 'Notifications' }).click();

    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    await expect(page.getByText(/\d+ unread/)).toBeVisible();
    // The All/Unread switch renders accessible tab buttons; switching must
    // move the selection without leaving the page.
    await page.getByRole('tab', { name: /Unread/ }).click();
    await expect(page.getByRole('tab', { name: /Unread/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  });

  test('changing the password with a wrong current password is rejected and keeps the session', async ({ page }) => {
    await login(page, STUDENT);
    await page.getByRole('link', { name: 'Settings' }).click();

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    // Labels render with a required-marker suffix ("New password*"), so target
    // the stable input ids instead of exact label text.
    await page.locator('#current-password').fill('NotTheCurrent1!');
    await page.locator('#new-password').fill('Student456!');
    await page.locator('#confirm-password').fill('Student456!');
    await page.getByRole('button', { name: 'Change password' }).click();

    await expect(page.getByText('Current password is incorrect')).toBeVisible();
    // The session must remain valid after the failed attempt.
    await expect(page.getByText(STUDENT[0]).first()).toBeVisible();
  });

  test('CLO–PLO mapping workspace renders for a tutor', async ({ page }) => {
    await login(page, TUTOR);
    await page.getByRole('link', { name: 'CLO–PLO mapping' }).click();

    await expect(page.getByRole('heading', { name: 'CLO–PLO mapping' })).toBeVisible();
    // The workspace body shows the mapping matrix plus the programme PLO list.
    await expect(page.getByRole('heading', { name: 'Mapping matrix' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Programme PLOs' })).toBeVisible();
    await expect(page.getByText(/\d+ CLOs · \d+ PLOs · \d+ mappings/)).toBeVisible();
  });
});
