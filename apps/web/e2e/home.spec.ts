import { expect, test } from '@playwright/test';

test('should load the home page and report service status when the stack is up', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(/All systems operational/);
  // Mobile-first: no horizontal scrolling at 360 px.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
