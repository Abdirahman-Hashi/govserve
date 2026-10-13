import { expect, test } from '@playwright/test';
import { latestCode } from './mailpit';

test('should register, verify by email and sign in again on a phone', async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'mobile',
    'Registration journey runs on the 360 px phone viewport',
  );
  const email = `e2e.${Date.now()}@example.com`;
  const password = 'mango river lantern 42';

  await page.goto('/register');
  await page.getByLabel('Full name').fill('Amina Hassan');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Phone number').fill('+252 61 234 5678');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.getByLabel('6-digit code').fill(await latestCode(request, email));
  await page.getByRole('button', { name: 'Verify and continue' }).click();

  await expect(page).toHaveURL(/\/citizen$/);
  await expect(page.getByRole('heading', { name: 'My applications' })).toBeVisible();

  // The session survives a reload through the httpOnly refresh cookie.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'My applications' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/citizen$/);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
