import { expect, test } from '@playwright/test';
import { applyForPoliceClearance, signUp } from './helpers';

test.describe('payments', () => {
  test.beforeEach(({ page: _page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Runs on the 360 px phone viewport');
  });

  test('should pay by card through the gateway, download the receipt and verify it publicly', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await signUp(page, request, `card.${Date.now()}@example.com`);
    await applyForPoliceClearance(page);
    await expect(page.getByTestId('balance')).toHaveText('Amount to pay: $17.00');

    await page.getByLabel('Card').check();
    await page.getByRole('button', { name: 'Pay $17.00 by card' }).click();

    // Mock gateway (development only) → signed webhook → back to GovServe.
    await expect(page.getByRole('heading', { name: 'Mock card checkout' })).toBeVisible();
    await page.getByRole('button', { name: 'Pay $17.00' }).click();
    await expect(page).toHaveURL(/\/citizen\/applications\/.+\?card=return/);
    await expect(page.getByText('Waiting for review').first()).toBeVisible({ timeout: 20_000 });

    const receipt = page.getByRole('button', { name: /Download receipt \(R-\d{4}-\d{6}\)/ });
    await expect(receipt).toBeVisible();
    const receiptNo = /R-\d{4}-\d{6}/.exec((await receipt.textContent()) ?? '')![0];
    const [download] = await Promise.all([page.waitForEvent('download'), receipt.click()]);
    expect(download.suggestedFilename()).toBe(`${receiptNo}.pdf`);

    // Anyone can check the receipt; without the QR signature the page says so.
    await page.goto(`/verify/r/${receiptNo}`);
    await expect(page.getByTestId('receipt-status')).toHaveText(/Valid receipt/);
    await expect(page.getByText('$17.00')).toBeVisible();
    await expect(page.getByText('Amina H***')).toBeVisible();
    await expect(page.getByText(/no signature/)).toBeVisible();
  });

  test('should report a mobile money payment for an officer to verify', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await signUp(page, request, `momo.${Date.now()}@example.com`);
    await applyForPoliceClearance(page);
    await page.getByLabel('Transaction ID').fill(`TX${Date.now()}`);
    await page.getByRole('button', { name: 'Send payment details' }).click();
    await expect(page.getByText(/An officer will check your payment/)).toBeVisible();
    await expect(page.getByText('Being checked by an officer')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });
});
