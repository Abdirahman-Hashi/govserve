import { expect, type Page, test } from '@playwright/test';
import { clearMailbox, latestCode } from './mailpit';

async function signIn(page: Page, request: Parameters<typeof latestCode>[0], email: string) {
  await clearMailbox(request, email);
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(process.env['E2E_STAFF_PASSWORD']!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('6-digit code').fill(await latestCode(request, email));
  await page.getByRole('button', { name: 'Confirm and sign in' }).click();
}

test.describe('audit trail', () => {
  test.beforeEach(({ page: _page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Staff work on desktop');
    test.skip(!process.env['E2E_STAFF_PASSWORD'], 'Set E2E_STAFF_PASSWORD to run staff flows');
  });

  test('should let an admin browse the trail and verify the hash chain', async ({
    page,
    request,
  }) => {
    await signIn(page, request, 'e2e-admin@govserve.test');
    await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();
    await page.getByRole('link', { name: 'Audit trail' }).click();
    const entries = page.getByTestId('audit-entries');
    await expect(entries).toBeVisible();
    // The admin's own sign-in is in the trail.
    await page.getByLabel('Action').fill('AUTH_LOGIN');
    await page.getByRole('button', { name: 'Show', exact: true }).click();
    await expect(entries.getByText('AUTH_LOGIN', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Verify the chain now' }).click();
    await expect(page.getByText(/The audit trail is intact/)).toBeVisible({ timeout: 20_000 });
  });
});
