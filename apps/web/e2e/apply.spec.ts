import { expect, type Page, test } from '@playwright/test';
import { latestCode } from './mailpit';

const PASSWORD = 'mango river lantern 42';

/** Chromium "Slow 3G" (DevTools preset): 400 ms latency, ~400 kbit/s each way. */
async function slow3g(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 400,
    downloadThroughput: (500 * 1024 * 0.8) / 8,
    uploadThroughput: (500 * 1024 * 0.8) / 8,
  });
}

const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(20 * 1024, 'a')]);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(15 * 1024, 1)]);

test('should complete a police clearance application end to end on a slow phone connection', async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Runs on the 360 px phone viewport');
  test.setTimeout(120_000);
  const email = `apply.${Date.now()}@example.com`;

  // Sign up (unthrottled, covered by auth.spec.ts).
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Amina Hassan');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Phone number').fill('+252 61 234 5678');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('6-digit code').fill(await latestCode(request, email));
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page).toHaveURL(/\/citizen$/);

  await slow3g(page);

  await page.goto('/services/POLICE_CLEARANCE');
  await page.getByRole('button', { name: 'Apply now' }).click();
  // On slow 3G the application page's code loads before the URL changes.
  await expect(page).toHaveURL(/\/citizen\/applications\/[0-9a-f-]+$/, { timeout: 30_000 });

  // Step 1: answers (autosaved).
  await page.getByLabel(/^Full name/).fill('Amina Hassan');
  await page.getByLabel(/^Date of birth/).fill('1990-04-12');
  await page.getByLabel(/^Place of birth/).fill('Mogadishu');
  await page.getByLabel(/^ID or passport number/).fill('SO1234567');
  await page.getByLabel(/^Mother's full name/).fill('Halima Yusuf');
  await page.getByLabel(/^Current address/).fill('Hodan district, near the market');
  await page.getByLabel('Employment').check();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 2: documents.
  await expect(page.getByRole('heading', { name: 'Upload your documents' })).toBeVisible();
  await page
    .getByLabel(/Choose file: National ID card or passport/)
    .setInputFiles({ name: 'id.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page
    .getByLabel(/Choose file: Passport-size photo/)
    .setInputFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  const rows = page
    .getByRole('listitem')
    .filter({ hasText: /National ID card or passport|Passport-size photo/ });
  // '✓ Uploaded' exactly: a plain 'Uploaded' would also match 'Not uploaded yet'.
  await expect(rows.filter({ hasText: /✓ Uploaded/ })).toHaveCount(2, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 3: review, one extra copy, submit.
  await expect(page.getByRole('heading', { name: 'Check your answers' })).toBeVisible();
  await page.getByLabel('Extra certified copies').selectOption('1');
  await expect(page.getByTestId('fee-total')).toHaveText('$17.00');
  await page.getByRole('button', { name: 'Submit application' }).click();

  // The status appears in the badge and the timeline.
  await expect(page.getByText('Awaiting payment').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('reference')).toHaveText(/^GS-\d{4}-\d{6}$/);
  await expect(page.getByTestId('assessed-total')).toHaveText('$17.00');

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
