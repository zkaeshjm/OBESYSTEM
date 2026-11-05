import { expect, test, type Page } from '@playwright/test';

const TUTOR = ['sara.malik@uiit.edu.pk', 'Tutor123!'] as const;
const OTHER_TUTOR = ['hamza.tariq@uiit.edu.pk', 'Tutor123!'] as const;
const ADMIN = ['admin@uiit.edu.pk', 'Admin123!'] as const;
const STUDENT = ['bilal.ahmed@student.uiit.edu.pk', 'Student123!'] as const;
const suffix = Date.now().toString(36).toUpperCase();

async function signOut(page: Page) {
  const account = page.getByRole('button', { name: 'Account menu' });
  if (await account.isVisible({ timeout: 1500 }).catch(() => false)) await account.click();
  const button = page.getByRole('button', { name: /Sign out/i });
  if (await button.isVisible({ timeout: 1500 }).catch(() => false)) {
    await button.click();
    await expect(page).toHaveURL(/\/login/);
  }
}

async function login(page: Page, credentials: readonly [string, string]) {
  if (!page.url().includes('/login')) await signOut(page);
  await page.goto('/login');
  await page.getByLabel('Official email').fill(credentials[0]);
  await page.getByLabel('Password').fill(credentials[1]);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
}

async function openCourse(page: Page) {
  await page.getByRole('link', { name: 'Courses', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Course catalogue' })).toBeVisible();
  await page.getByRole('link', { name: /CS-401/ }).first().click();
  await expect(page.getByRole('heading', { name: /CS-401 — Machine Learning/ })).toBeVisible();
}

async function openOffering(page: Page) {
  await page.getByRole('link', { name: 'Course offerings' }).click();
  await expect(page.getByRole('link', { name: /CS-401 — Machine Learning/ }).first()).toBeVisible();
  await page.getByRole('link', { name: /CS-401 — Machine Learning/ }).first().click();
  await expect(page.getByRole('heading', { name: /CS-401 — Machine Learning/ })).toBeVisible();
}

async function openStudentOffering(page: Page) {
  await page.getByRole('link', { name: 'Course offerings' }).click();
  await expect(page.getByRole('heading', { name: 'My courses' })).toBeVisible();
  await page.getByRole('link', { name: /CS-401 — Machine Learning/ }).first().click();
  await expect(page.getByRole('heading', { name: /CS-401 — Machine Learning/ })).toBeVisible();
}

test.describe('isolated tutor panel end-to-end workflow', () => {
  test.describe.configure({ timeout: 120_000 });

  test('completes the persisted tutor workflow and enforces ownership', async ({ page }) => {
    const cloCode = `CLO-E2E-${suffix}`;
    const assessmentTitle = `E2E evidence ${suffix}`;

    await login(page, TUTOR);
    await openCourse(page);

    // Tutor creates, edits and adds measurable criteria to a pending CLO.
    await page.getByRole('button', { name: /New CLO/i }).click();
    await page.getByLabel('Code').fill(cloCode);
    await page.getByLabel('Measurable outcome').fill('Evaluate a machine learning pipeline against measurable quality criteria');
    await page.getByRole('button', { name: /Create CLO/i }).click();
    await expect(page.getByText(cloCode, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Edit ${cloCode}` }).click();
    await page.getByLabel('Measurable outcome').fill('Evaluate a machine learning pipeline against reproducible quality criteria');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('CLO updated.')).toBeVisible();
    await page.getByRole('button', { name: `Measurement criteria for ${cloCode}` }).click();
    await page.getByRole('button', { name: 'Add criterion' }).click();
    await page.getByLabel('Criterion 1 statement').fill('Reports reproducible validation evidence');
    await page.getByRole('button', { name: 'Save criteria' }).click();
    await expect(page.getByText(/Measurement criteria for .* saved/)).toBeVisible();

    // Approval remains an administrator action; the tutor cannot self-approve.
    await login(page, ADMIN);
    await openCourse(page);
    await page.getByText(cloCode, { exact: true }).waitFor();
    // Approve strictly inside the new CLO's own card: the seeded course also
    // contains a PENDING CLO whose Approve button must not absorb the click.
    await page
      .locator('div.px-4.py-4', { hasText: cloCode })
      .first()
      .getByRole('button', { name: 'Approve' })
      .click();
    await expect(page.getByText(`${cloCode} approved.`)).toBeVisible();

    await login(page, TUTOR);
    await openOffering(page);
    const offeringUrl = page.url();
    await page.getByRole('tab', { name: /Assessments/ }).click();
    await page.getByRole('button', { name: /New assessment/i }).click();
    await page.getByLabel('Title').fill(assessmentTitle);
    await page.getByLabel('Type').selectOption('ASSIGNMENT');
    await page.getByLabel('Label').first().fill('Evidence item');
    await page.getByRole('button', { name: /Add criterion/i }).click();
    await page.getByLabel('Criterion 1 label').fill('Validation evidence');
    await page.getByLabel('Criterion 1 maximum marks').fill('10');
    await page.locator('label', { hasText: cloCode }).first().click();
    await page.getByRole('button', { name: /Create draft/i }).click();
    await expect(page.getByText(assessmentTitle, { exact: true })).toBeVisible();

    const assessmentLink = page.getByRole('link', { name: assessmentTitle, exact: true });
    // Publish strictly from the new assessment's own row: the seeded offering
    // also contains a draft ("Assignment 2 — Feature Engineering") whose
    // Publish button must never absorb this click.
    await expect(assessmentLink).toBeVisible();
    await page
      .getByRole('row', { name: new RegExp(assessmentTitle) })
      .getByRole('button', { name: 'Publish' })
      .click();
    await expect(page.getByText('Assessment published and students notified.')).toBeVisible();
    await assessmentLink.click();
    const assessmentUrl = page.url();

    // Student submits through the real student-facing route.
    await login(page, STUDENT);
    await openStudentOffering(page);
    await page.getByRole('tab', { name: /Assessments/ }).click();
    await page.getByRole('link', { name: assessmentTitle, exact: true }).click();
    await page.getByLabel('Submission text').fill('Student evidence for the measurable CLO.');
    await page.getByRole('button', { name: /Submit assessment/i }).click();
    await expect(page.getByText('Submission received.')).toBeVisible();

    // Tutor grades the rubric, publishes results, then performs an audited regrade.
    await login(page, TUTOR);
    await page.goto(assessmentUrl);
    await expect(page.getByRole('heading', { name: assessmentTitle })).toBeVisible();
    await page.getByRole('button', { name: 'Grade', exact: true }).first().click();
    await page.getByLabel('Validation evidence marks').fill('8');
    await page.getByLabel('Overall feedback').fill('Good evidence; add a second validation case.');
    await page.getByRole('button', { name: 'Save grades' }).click();
    await expect(page.getByText('Grades saved.')).toBeVisible();
    await page.getByRole('button', { name: /Publish results/ }).click();
    await expect(page.getByText('Results published to students.')).toBeVisible();
    await page.getByRole('button', { name: 'Edit grade' }).first().click();
    await page.getByLabel('Validation evidence marks').fill('9');
    await page.getByLabel('Reason for correction').fill('Corrected rubric transcription after moderation');
    await page.getByRole('button', { name: 'Save grades' }).click();
    await expect(page.getByText('Grades saved.')).toBeVisible();
    await page.getByRole('button', { name: 'View grade history' }).first().click();
    await expect(page.getByText('Corrected rubric transcription after moderation')).toBeVisible();
    // The dialog renders a compact header button and a footer button; target
    // the footer control inside the dialog to avoid strict-mode ambiguity.
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();

    // Persisted attainment and report exports are scoped to the assigned offering.
    await page.goto(offeringUrl);
    await page.getByRole('button', { name: /Calculate attainment/ }).click();
    await expect(page.getByText('Attainment calculated and stored as a new run.')).toBeVisible();
    await page.getByRole('tab', { name: /Attainment/ }).click();
    await expect(page.getByText(cloCode, { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Attainment & gaps' }).click();
    await expect(page.getByRole('heading', { name: 'Attainment & gap analysis' })).toBeVisible();
    const pdfDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export PDF/ }).click();
    expect((await pdfDownload).suggestedFilename()).toMatch(/\.pdf$/);
    await page.getByRole('link', { name: 'PLO framework' }).click();
    await expect(page.getByRole('heading', { name: 'Programme learning outcomes' })).toBeVisible();
    await page.getByRole('link', { name: /PLO-1/ }).first().click();
    await expect(page.getByText('Offering contributions')).toBeVisible();

    // The assessment is archived and restored without deleting its evidence.
    await page.goto(assessmentUrl);
    await page.getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('button', { name: 'Archive assessment' }).click();
    await expect(page.getByText('Assessment archived.')).toBeVisible();
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText('Assessment restored.')).toBeVisible();

    // Direct URL access by another tutor is rejected by the API, not merely
    // hidden in navigation.
    await login(page, OTHER_TUTOR);
    await page.goto(offeringUrl);
    await expect(page.getByText(/not assigned|authorized|Unable to load offering/i)).toBeVisible();
    await page.goto(assessmentUrl);
    await expect(page.getByText(/not assigned|authorized|permission|Unable to load assessment/i)).toBeVisible();
  });
});
