import { expect, test } from '@playwright/test';
import { applyForProofOfAddress, signUp } from './helpers';
import { clearMailbox, latestCode } from './mailpit';

const OFFICER = 'e2e-officer@govserve.test';

test.describe('officer review', () => {
  test.beforeEach(({ page: _page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Officers work on desktop');
    test.skip(!process.env['E2E_STAFF_PASSWORD'], 'Set E2E_STAFF_PASSWORD to run the officer flow');
  });

  test('should review, approve and issue a verifiable certificate', async ({
    browser,
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    // Citizen applies and pays by card (the mock gateway confirms by signed webhook).
    await signUp(page, request, `review.${Date.now()}@example.com`);
    const reference = await applyForProofOfAddress(page);
    await page.getByLabel('Card').check();
    await page.getByRole('button', { name: /^Pay \$[\d.]+ by card$/ }).click();
    await page.getByRole('button', { name: /^Pay \$[\d.]+$/ }).click();
    await expect(page.getByText('Waiting for review').first()).toBeVisible({ timeout: 20_000 });
    const applicationUrl = page.url().replace(/\?.*$/, '');

    // Officer signs in on a fresh device (email code), finds it in the queue and approves it.
    const officer = await (await browser.newContext()).newPage();
    await clearMailbox(request, OFFICER);
    await officer.goto('/login');
    await officer.getByLabel('Email address').fill(OFFICER);
    await officer.getByLabel('Password').fill(process.env['E2E_STAFF_PASSWORD']!);
    await officer.getByRole('button', { name: 'Sign in' }).click();
    await officer.getByLabel('6-digit code').fill(await latestCode(request, OFFICER));
    await officer.getByRole('button', { name: 'Confirm and sign in' }).click();
    await expect(officer.getByRole('heading', { name: 'Work queue' })).toBeVisible();
    await officer.getByRole('link', { name: new RegExp(`Open\\s*: ${reference}`) }).click();
    await expect(officer.getByTestId('answer-idNumber')).toHaveText('••••');
    await officer.getByRole('button', { name: 'Claim' }).click();
    await officer
      .getByRole('group', { name: 'Claim' })
      .getByRole('button', { name: 'Confirm' })
      .click();
    await expect(officer.getByTestId('review-status')).toContainText('In review');
    await officer.getByRole('button', { name: 'Approve' }).click();
    await officer
      .getByRole('group', { name: 'Approve' })
      .getByRole('button', { name: 'Confirm' })
      .click();
    await expect(officer.getByTestId('review-status')).toContainText('Issued');

    // The citizen downloads the certificate and anyone can verify it.
    await page.goto(applicationUrl);
    const certNo = (await page.getByTestId('certificate-no').textContent())!;
    expect(certNo).toMatch(/^ADR-\d{4}-\d{6}$/);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download PDF' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`${certNo}.pdf`);

    await page.goto(`/verify/c/${certNo}`);
    await expect(page.getByTestId('certificate-status')).toHaveText(/Valid certificate/);
    await expect(page.getByText('Amina H*** W***')).toBeVisible();
    await page.getByLabel('Full name').fill('Amina Hassan Warsame');
    await page.getByRole('button', { name: 'Check name' }).click();
    await expect(page.getByText('The name matches the certificate holder.')).toBeVisible();

    // Search and history (Phase 08): the officer finds it by part of the reference…
    await officer.getByRole('link', { name: 'Search' }).click();
    await officer.getByLabel('Reference number (part)').fill(reference.slice(-6));
    await officer.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(
      officer.getByTestId('application-results').getByRole('link', { name: reference }),
    ).toBeVisible();
    // …and the citizen filters their own list to issued certificates.
    await page.goto('/citizen');
    await page.getByText('Filter', { exact: true }).click();
    await page.getByLabel('Status').selectOption('ISSUED');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByTestId('my-applications').getByText(reference)).toBeVisible();
  });
});
