import { expect, test } from '@playwright/test';
import { clearMailbox, latestCode } from './mailpit';

const SUPERVISOR = 'e2e-supervisor@govserve.test';

test.describe('management dashboard', () => {
  test.beforeEach(({ page: _page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Supervisors work on desktop');
    test.skip(!process.env['E2E_STAFF_PASSWORD'], 'Set E2E_STAFF_PASSWORD to run staff flows');
  });

  test('should show the department dashboard and drill down to a list', async ({
    page,
    request,
  }) => {
    await clearMailbox(request, SUPERVISOR);
    await page.goto('/login');
    await page.getByLabel('Email address').fill(SUPERVISOR);
    await page.getByLabel('Password').fill(process.env['E2E_STAFF_PASSWORD']!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByLabel('6-digit code').fill(await latestCode(request, SUPERVISOR));
    await page.getByRole('button', { name: 'Confirm and sign in' }).click();

    await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page.getByTestId('kpi-net')).toContainText(/\$[\d,]+\.\d{2}/);
    await expect(page.getByTestId('kpi-sla')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Net collections per day' })).toBeVisible();
    await expect(page.getByTestId('officers')).toBeVisible();

    await page.getByTestId('kpi-net').getByRole('link').click();
    await expect(page).toHaveURL(/\/officer\/dashboard\/details\?.*view=movements/);
    await expect(page.getByRole('heading', { name: 'All money movements' })).toBeVisible();
  });
});
