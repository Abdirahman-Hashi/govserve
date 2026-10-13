import { expect, type Page, test } from '@playwright/test';
import { pdf, signUp } from './helpers';
import { clearMailbox, latestCode } from './mailpit';

const OFFICER = 'e2e-officer@govserve.test';

async function applyForProofOfAddress(page: Page): Promise<string> {
  await page.goto('/services/PROOF_OF_ADDRESS');
  await page.getByRole('button', { name: 'Apply now' }).click();
  await expect(page).toHaveURL(/\/citizen\/applications\/[0-9a-f-]+$/, { timeout: 30_000 });
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
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(page.getByTestId('reference')).toHaveText(/^GS-\d{4}-\d{6}$/, { timeout: 30_000 });
  return (await page.getByTestId('reference').textContent())!;
}

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
  });
});
