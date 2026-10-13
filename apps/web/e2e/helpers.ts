import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { latestCode } from './mailpit';

export const PASSWORD = 'mango river lantern 42';
export const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(20 * 1024, 'a')]);
export const jpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(15 * 1024, 1),
]);

export async function signUp(page: Page, request: APIRequestContext, email: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Amina Hassan');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Phone number').fill('+252 61 234 5678');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('6-digit code').fill(await latestCode(request, email));
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page).toHaveURL(/\/citizen$/);
}

/** Applies for police clearance with one extra copy ($17.00) and lands on the status page. */
export async function applyForPoliceClearance(page: Page): Promise<void> {
  await page.goto('/services/POLICE_CLEARANCE');
  await page.getByRole('button', { name: 'Apply now' }).click();
  // The service page has a preview of the same form: wait for the application page first.
  await expect(page).toHaveURL(/\/citizen\/applications\/[0-9a-f-]+$/, { timeout: 30_000 });
  await page.getByLabel(/^Full name/).fill('Amina Hassan');
  await page.getByLabel(/^Date of birth/).fill('1990-04-12');
  await page.getByLabel(/^Place of birth/).fill('Mogadishu');
  await page.getByLabel(/^ID or passport number/).fill('SO1234567');
  await page.getByLabel(/^Mother's full name/).fill('Halima Yusuf');
  await page.getByLabel(/^Current address/).fill('Hodan district, near the market');
  await page.getByLabel('Employment').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page
    .getByLabel(/Choose file: National ID card or passport/)
    .setInputFiles({ name: 'id.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page
    .getByLabel(/Choose file: Passport-size photo/)
    .setInputFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(page.getByRole('listitem').filter({ hasText: 'Uploaded' })).toHaveCount(2, {
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Extra certified copies').selectOption('1');
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(page.getByTestId('reference')).toHaveText(/^GS-\d{4}-\d{6}$/, { timeout: 30_000 });
}
