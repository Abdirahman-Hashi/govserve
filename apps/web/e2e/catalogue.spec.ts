import { expect, test } from '@playwright/test';

test('should browse the catalogue and estimate a police clearance fee', async ({ page }) => {
  await page.goto('/services');
  await expect(page.getByRole('heading', { name: 'Services', level: 1 })).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search services' }).fill('criminal');
  await page.getByRole('button', { name: 'Search' }).click();
  const link = page.getByRole('link', { name: /Police clearance/ });
  await expect(link).toBeVisible();
  await expect(page.getByRole('link', { name: /Proof of address/ })).toHaveCount(0);

  await link.click();
  await expect(page.getByRole('heading', { name: /Police clearance/, level: 1 })).toBeVisible();
  await expect(page.getByText('You will be asked to visit for fingerprints')).toBeVisible();
  await expect(
    page.getByText('This fee is provisional and may change before applications open.'),
  ).toBeVisible();

  const total = page.getByTestId('fee-total');
  await expect(total).toHaveText('$15.00');
  await page.getByLabel('Extra certified copies').selectOption('2');
  await expect(total).toHaveText('$19.00');

  // The form preview applies the travel rule from the published schema.
  await expect(page.getByLabel(/Destination country/)).toHaveCount(0);
  await page.getByLabel('Travel').check();
  await expect(page.getByLabel(/Destination country/)).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
