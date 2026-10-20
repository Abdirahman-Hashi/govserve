import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { applyForProofOfAddress, pdf, signUp } from './helpers';
import { clearMailbox, latestCode } from './mailpit';

/** WCAG 2.1 AA (NFR-008): every A and AA rule axe has for 2.0 and 2.1. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Fails with a readable list: rule, impact, and the first offending elements. */
async function expectAccessible(page: Page, name: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const report = violations.map(
    (v) =>
      `${v.id} (${v.impact ?? 'n/a'}): ${v.help}\n    ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join('\n    ')}`,
  );
  expect(report, `${name} has WCAG 2.1 AA violations`).toEqual([]);
}

async function check(page: Page, path: string, ready: (page: Page) => Promise<unknown>) {
  await page.goto(path);
  await ready(page);
  await expectAccessible(page, path);
}

const heading = (name: string | RegExp) => (page: Page) =>
  expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();

async function staffPage(
  browser: Browser,
  request: APIRequestContext,
  email: string,
): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await clearMailbox(request, email);
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(process.env['E2E_STAFF_PASSWORD']!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('6-digit code').fill(await latestCode(request, email));
  await page.getByRole('button', { name: 'Confirm and sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  return page;
}

test.describe('accessibility (WCAG 2.1 AA)', () => {
  test('should report no violations when public pages load', async ({ page }) => {
    await check(page, '/', heading(/./));
    await check(page, '/services', heading(/./));
    await check(page, '/services/PROOF_OF_ADDRESS', heading(/./));
    await check(page, '/login', (p) => expect(p.getByLabel('Password')).toBeVisible());
    await check(page, '/register', (p) => expect(p.getByLabel('Full name')).toBeVisible());
    await check(page, '/forgot-password', (p) =>
      expect(p.getByLabel('Email address')).toBeVisible(),
    );
    await check(page, '/verify/c/ADR-2000-000000', heading(/./));
    await check(page, '/verify/r/R-2000-000000', heading(/./));
    await check(page, '/no-such-page', heading(/./));
  });

  test('should report no violations when a citizen applies and views their pages', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    await signUp(page, request, `a11y.${testInfo.project.name}.${Date.now()}@example.com`);
    await expectAccessible(page, '/citizen');

    await page.goto('/services/PROOF_OF_ADDRESS');
    await page.getByRole('button', { name: 'Apply now' }).click();
    await expect(page).toHaveURL(/\/citizen\/applications\/[0-9a-f-]+$/, { timeout: 30_000 });
    await expectAccessible(page, 'wizard: applicant step');
    // An attempt to continue with nothing filled in shows the error state.
    await page.getByRole('button', { name: 'Continue' }).click();
    await expectAccessible(page, 'wizard: validation errors');
    await page.getByLabel(/^Full name/).fill('Amina Hassan Warsame');
    await page.getByLabel(/^Date of birth/).fill('1990-04-12');
    await page.getByLabel(/^ID or passport number/).fill('SO7654321');
    await page.getByLabel(/^Phone number/).fill('+252 61 234 5678');
    await page.getByLabel(/^Email address/).fill('amina@example.com');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel(/^District/).fill('Hodan');
    await page.getByLabel(/^Neighbourhood/).fill('Taleex');
    await page.getByLabel(/^Street or landmark/).fill('Near the Taleex junction');
    await page.getByLabel(/^Years at this address/).fill('4');
    await page.getByLabel('I rent it').check();
    await expectAccessible(page, 'wizard: address step');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page
      .getByLabel(/Choose file: National ID card or passport/)
      .setInputFiles({ name: 'id.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page
      .getByLabel(/Choose file: Utility bill/)
      .setInputFiles({ name: 'bill.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(page.getByRole('status').filter({ hasText: /✓ Uploaded/ })).toHaveCount(2, {
      timeout: 30_000,
    });
    await expectAccessible(page, 'wizard: documents step');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expectAccessible(page, 'wizard: review step');
    await page.getByRole('button', { name: 'Submit application' }).click();
    await expect(page.getByTestId('reference')).toBeVisible({ timeout: 30_000 });
    await expectAccessible(page, 'application status with payment panel');

    await check(page, '/citizen/payments', heading(/./));
    await check(page, '/citizen/certificates', heading(/./));
    await check(page, '/account/profile', heading(/./));
    await check(page, '/account/notifications', heading(/./));
  });

  test.describe('staff pages', () => {
    test.beforeEach(({ page: _page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'Staff work on desktop');
      test.skip(!process.env['E2E_STAFF_PASSWORD'], 'Set E2E_STAFF_PASSWORD to run staff pages');
    });

    test('should report no violations when officers, supervisors and admins work', async ({
      browser,
      page,
      request,
    }) => {
      test.setTimeout(180_000);
      // A paid application, so the queue and the review screen have something to show.
      await signUp(page, request, `a11y.staff.${Date.now()}@example.com`);
      const reference = await applyForProofOfAddress(page);
      await page.getByLabel('Card').check();
      await page.getByRole('button', { name: /^Pay \$[\d.]+ by card$/ }).click();
      await page.getByRole('button', { name: /^Pay \$[\d.]+$/ }).click();
      await expect(page.getByText('Waiting for review').first()).toBeVisible({ timeout: 20_000 });

      const officer = await staffPage(browser, request, 'e2e-a11y-officer@govserve.test');
      await check(officer, '/officer', heading('Work queue'));
      await officer.getByRole('link', { name: new RegExp(`Open\\s*: ${reference}`) }).click();
      await expect(officer.getByTestId('review-status')).toBeVisible();
      await expectAccessible(officer, 'review screen');
      await check(officer, '/officer/search', heading(/./));
      await check(officer, '/officer/payments', heading(/./));
      await check(officer, '/officer/cash', heading(/./));

      const supervisor = await staffPage(browser, request, 'e2e-a11y-supervisor@govserve.test');
      await check(supervisor, '/officer/dashboard', heading(/./));
      await check(supervisor, '/officer/audit', heading(/./));
      await check(supervisor, '/officer/refunds', heading(/./));

      const admin = await staffPage(browser, request, 'e2e-a11y-admin@govserve.test');
      await check(admin, '/admin/staff', heading(/./));
      await check(admin, '/admin/services', heading(/./));
      await check(admin, '/admin/config', heading(/./));
      await check(admin, '/admin/dashboard', heading(/./));
      await check(admin, '/admin/audit', heading(/./));
    });
  });
});
