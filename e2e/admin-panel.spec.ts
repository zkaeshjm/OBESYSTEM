import { expect, test, type Page, type APIRequestContext } from '@playwright/test';

/**
 * Administrator-panel browser coverage.
 *
 * Complements critical-flows.spec.ts (read-only admin navigation) and the
 * server/tests/admin-panel.test.ts API suite. These tests execute the admin
 * write workflows through the real UI — academic structure CRUD, account
 * management, session activation, policy versioning — and cross-check the
 * institutional dashboard against the live API so numbers can never be
 * hardcoded.
 */

const ADMIN = { email: 'admin@uiit.edu.pk', password: 'Admin123!' };
const base = 'http://localhost:4000/api/v1';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Official email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
}

async function confirmAction(page: Page, dialogTitle: string, confirmLabel: string) {
  const dialog = page.getByRole('dialog', { name: dialogTitle });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: confirmLabel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function apiDashboard(request: APIRequestContext) {
  const login = await request.post(`${base}/auth/login`, { data: ADMIN });
  expect(login.ok()).toBeTruthy();
  const { accessToken } = (await login.json()).data as { accessToken: string };
  const dashboard = await request.get(`${base}/dashboard`, { headers: { Authorization: `Bearer ${accessToken}` } });
  expect(dashboard.ok()).toBeTruthy();
  const body = (await dashboard.json()) as {
    data: { role: string; cards: Array<{ key: string; label: string; value: number }> };
  };
  return body.data;
}

test.describe('administrator panel workflows', () => {
  test('manages a department through create, edit, search filter and deactivation', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Departments' }).click();
    await expect(page.getByRole('heading', { name: 'Departments' })).toBeVisible();

    // Create
    await page.getByRole('button', { name: /New department/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#dept-name').fill('Quality Assurance Unit');
    await dialog.locator('#dept-code').fill('QA');
    await dialog.locator('#dept-hod').fill('Dr. Naheed Anwar');
    await dialog.locator('#dept-contact').fill('ext-410');
    await dialog.getByRole('button', { name: 'Create department' }).click();
    await expect(page.getByRole('status').first()).toContainText('Department created');
    const row = page.getByRole('row', { name: /Quality Assurance Unit/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Active');

    // Search filter narrows to the seeded institute and the new unit.
    await page.getByLabel('Search departments').fill('QA');
    await expect(page.getByRole('row', { name: /Quality Assurance Unit/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /University Institute/ })).toHaveCount(0);
    await page.getByLabel('Search departments').fill('');

    // Edit
    await row.getByRole('button', { name: 'Edit Quality Assurance Unit' }).click();
    await page.getByRole('dialog').locator('#dept-name').fill('Quality Assurance Bureau');
    await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').first()).toContainText('Department updated');
    await expect(page.getByRole('row', { name: /Quality Assurance Bureau/ })).toBeVisible();

    // Deactivation flags the record; the row and its history remain.
    const renamedRow = page.getByRole('row', { name: /Quality Assurance Bureau/ });
    await renamedRow.getByRole('button', { name: 'Deactivate Quality Assurance Bureau' }).click();
    await confirmAction(page, 'Deactivate department', 'Deactivate');
    await expect(page.getByRole('status').first()).toContainText('Department deactivated');
    await expect(page.getByRole('row', { name: /Quality Assurance Bureau/ })).toContainText('Inactive');
    await expect(page.getByRole('row', { name: /Quality Assurance Bureau/ })).toBeVisible();
  });

  test('creates a programme inside the seeded institute', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Programmes' }).click();
    await expect(page.getByRole('heading', { name: 'Academic programmes' })).toBeVisible();

    await page.getByRole('button', { name: /New programme/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#program-department').selectOption({ label: 'University Institute of Information Technology (UIIT)' });
    await dialog.locator('#program-name').fill('BS Cyber Security');
    await dialog.locator('#program-code').fill('BSCYS');
    await dialog.locator('#program-credits').fill('132');
    await dialog.getByRole('button', { name: 'Create programme' }).click();
    await expect(page.getByRole('status').first()).toContainText('Programme created.');

    // Programme cards render as Card components (rounded-3xl sections).
    const card = page.locator('section.rounded-3xl', { hasText: 'BS Cyber Security' }).first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('132');
    await expect(card).toContainText('Active');
  });

  test('creates, toggles and resets an account for a tutor', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Users & students' }).click();
    await expect(page.getByRole('heading', { name: 'Users & students' })).toBeVisible();

    // Create a tutor account through the real form.
    await page.getByRole('button', { name: /New account/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#user-name').fill('Imran Rashid');
    await dialog.locator('#user-email').fill('imran.rashid@uiit.edu.pk');
    await dialog.locator('#user-role').selectOption('TUTOR');
    await dialog.locator('#user-password').fill('Tutor--2027!');
    await dialog.locator('#user-department').selectOption({ label: 'University Institute of Information Technology' });
    await dialog.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('status').first()).toContainText('Account created');

    const row = page.getByRole('row', { name: /Imran Rashid/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Active');

    // Deactivate then reactivate through the row actions; both are confirmed.
    await row.getByRole('button', { name: 'Deactivate Imran Rashid' }).click();
    await confirmAction(page, 'Deactivate account', 'Deactivate');
    await expect(page.getByRole('status').first()).toContainText('Account deactivated');
    await expect(row).toContainText('Inactive', { timeout: 10_000 });
    await row.getByRole('button', { name: 'Reactivate Imran Rashid' }).click();
    await confirmAction(page, 'Reactivate account', 'Reactivate');
    await expect(page.getByRole('status').first()).toContainText('Account reactivated');
    await expect(row).toContainText('Active', { timeout: 10_000 });

    // Administrative password reset revokes the account's sessions.
    await row.getByRole('button', { name: 'Reset password for Imran Rashid' }).click();
    const resetDialog = page.getByRole('dialog', { name: 'Reset password for Imran Rashid' });
    await expect(resetDialog).toBeVisible();
    await resetDialog.locator('#reset-password').fill('Reset--2027!');
    await resetDialog.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByRole('status').first()).toContainText('Password reset');

    // The sign-in credentials created through the UI must now work end to end.
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('button', { name: /Sign out/i }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel('Official email').fill('imran.rashid@uiit.edu.pk');
    await page.getByLabel('Password').fill('Reset--2027!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
  });

  test('activates a new academic session atomically', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Academic sessions' }).click();
    await expect(page.getByRole('heading', { name: 'Academic sessions' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Spring 2026/ })).toContainText('Active');

    await page.getByRole('button', { name: /New session/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#semester-name').fill('Spring 2027');
    await dialog.locator('#semester-start').fill('2027-02-02');
    await dialog.locator('#semester-end').fill('2027-06-30');
    await dialog.getByText('Make this the active institutional session').click();
    await dialog.getByRole('button', { name: 'Create session' }).click();
    await expect(page.getByRole('status').first()).toContainText('Academic session created');

    // Exactly one active session remains, and it is the new one.
    const newRow = page.getByRole('row', { name: /Spring 2027/ });
    await expect(newRow).toContainText('Active');
    await expect(newRow).toContainText('Institution-wide active session');
    await expect(page.getByRole('row', { name: /Spring 2026/ })).toContainText('Inactive');
    await expect(page.locator('tbody').getByText('Active', { exact: true })).toHaveCount(1);
  });

  test('creates a new attainment-policy version and can reactivate an older one', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Attainment policy' }).click();
    await expect(page.getByRole('heading', { name: 'Attainment policy' })).toBeVisible();

    await page.getByRole('button', { name: /New version/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('#policy-name')).toHaveValue(/Institutional OBE policy/);
    await expect(dialog.locator('#policy-version')).toHaveValue(/\d{4}\.\d+/);
    await dialog.locator('#policy-description').fill('Tightened thresholds from the parity pass.');
    await dialog.getByRole('button', { name: 'Create and activate' }).click();
    await expect(page.getByRole('status').first()).toContainText('Policy version created and activated');

    // The fresh version is active; the seeded one is now superseded.
    const activeCard = page.locator('div').filter({ hasText: /Tightened thresholds from the parity pass/ }).last();
    await expect(activeCard).toContainText('Active');
    await expect(page.getByText('Superseded').first()).toBeVisible();

    // Reactivating the seeded version is a confirmed, audited admin action.
    const seededCard = page.locator('div').filter({ hasText: 'Institutional OBE Policy (default)' }).first();
    await seededCard.getByRole('button', { name: 'Activate', exact: true }).click();
    await confirmAction(page, 'Activate policy version', 'Activate');
    await expect(page.getByRole('status').first()).toContainText('is now active');
  });

  test('renders the dashboard from live database state (UI matches the API)', async ({ page, request }) => {
    // Request the dashboard through a separate API context: page.request would
    // share the browser's cookie jar and silently sign the page in.
    const api = await apiDashboard(request);
    expect(api.role).toBe('ADMIN');

    await login(page);
    await expect(page.getByText('Institutional overview')).toBeVisible();

    // Every metric card on the screen must equal the value the API computes
    // from the same database state.
    for (const card of api.cards as Array<{ key: string; label: string; value: number }>) {
      const labelElement = page.locator('main').getByText(card.label, { exact: true }).first();
      await expect(labelElement).toBeVisible();
      const statCard = labelElement.locator('..');
      await expect(statCard).toContainText(String(card.value), { timeout: 10_000 });
      // Detail lines must be live context, never a placeholder.
      await expect(statCard.locator('p').last()).not.toBeEmpty();
    }
  });
});
