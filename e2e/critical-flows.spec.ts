import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Official email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
}

test.describe('administrator workflow', () => {
  test('signs in, sees real institutional metrics and navigates academic structure', async ({ page }) => {
    await login(page, 'admin@uiit.edu.pk', 'Admin123!');
    await expect(page.getByText('Institutional overview')).toBeVisible();
    await expect(page.getByText('Active students')).toBeVisible();
    await expect(page.getByText('Course offerings').first()).toBeVisible();

    await page.getByRole('link', { name: 'Programmes' }).click();
    await expect(page.getByRole('heading', { name: 'Academic programmes' })).toBeVisible();
    await expect(page.getByText('BS Computer Science')).toBeVisible();

    await page.getByRole('link', { name: 'Courses', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Course catalogue' })).toBeVisible();
    await expect(page.getByText('CS-401').first()).toBeVisible();
    await expect(page.getByText('Machine Learning').first()).toBeVisible();

    await page.getByRole('link', { name: 'Attainment policy' }).click();
    await expect(page.getByRole('heading', { name: 'Attainment policy' })).toBeVisible();
    await expect(page.getByText('Institutional OBE Policy (default)')).toBeVisible();

    await page.getByRole('link', { name: 'Audit log' }).click();
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'COMPUTE_ATTAINMENT' }).first()).toBeVisible();
  });
});

test.describe('tutor workflow', () => {
  test('sees only assigned offerings, reviews attainment and opens grading', async ({ page }) => {
    await login(page, 'sara.malik@uiit.edu.pk', 'Tutor123!');
    await expect(page.getByText('Teaching overview')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Users & students' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Audit log' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Course offerings' }).click();
    await expect(page.getByRole('heading', { name: 'My course offerings' })).toBeVisible();
    await page.getByRole('link', { name: /CS-401 — Machine Learning/ }).first().click();

    await expect(page.getByRole('heading', { name: 'CS-401 — Machine Learning' })).toBeVisible();
    await page.getByRole('tab', { name: /Attainment/ }).click();
    await expect(page.getByText('CLO attainment')).toBeVisible();
    await expect(page.getByText('CLO-3').first()).toBeVisible();
    await expect(page.getByText('NOT MET').first()).toBeVisible();

    await page.getByRole('tab', { name: /Assessments/ }).click();
    await page.getByRole('link', { name: 'Applied Machine Learning Project' }).click();
    await expect(page.getByRole('heading', { name: 'Applied Machine Learning Project' })).toBeVisible();
    await expect(page.getByText('Submissions')).toBeVisible();
    await page.getByRole('button', { name: 'Edit grade' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByLabel('Overall feedback')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
  });
});

test.describe('student workflow', () => {
  test('views enrolled course, published results and feedback', async ({ page }) => {
    await login(page, 'bilal.ahmed@student.uiit.edu.pk', 'Student123!');
    await expect(page.getByText('Learning overview')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Users & students' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Course offerings' }).click();
    await expect(page.getByRole('heading', { name: 'My courses' })).toBeVisible();
    await page.getByRole('link', { name: /CS-401 — Machine Learning/ }).first().click();
    await expect(page.getByRole('heading', { name: 'CS-401 — Machine Learning' })).toBeVisible();

    await page.getByRole('tab', { name: /Assessments/ }).click();
    await page.getByRole('link', { name: 'Applied Machine Learning Project' }).click();
    await expect(page.getByRole('heading', { name: 'Your submission' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Feedback and marks' })).toBeVisible();
    await expect(page.getByText(/Good structure/)).toBeVisible();
  });

  test('cannot reach an administrator route by changing the URL', async ({ page }) => {
    await login(page, 'bilal.ahmed@student.uiit.edu.pk', 'Student123!');
    await page.goto('/users');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
  });
});
