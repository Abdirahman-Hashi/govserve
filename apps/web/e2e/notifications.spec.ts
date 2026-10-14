import { expect, test } from '@playwright/test';
import { applyForPoliceClearance, signUp } from './helpers';

const MAILPIT = process.env['MAILPIT_URL'] ?? 'http://localhost:8025';

test.describe('notifications', () => {
  test.beforeEach(({ page: _page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Runs on the 360 px phone viewport');
  });

  test('should notify in the app and by email after submitting', async ({ page, request }) => {
    test.setTimeout(120_000);
    const email = `notify.${Date.now()}@example.com`;
    await signUp(page, request, email);
    await applyForPoliceClearance(page);
    const reference = (await page.getByTestId('reference').textContent())!;

    // The outbox relay runs every few seconds; the badge polls once a minute, so reload.
    await expect
      .poll(
        async () => {
          await page.reload();
          // The unread count loads after the page: give it a moment before deciding.
          return page
            .getByTestId('unread-badge')
            .waitFor({ timeout: 3_000 })
            .then(() => true)
            .catch(() => false);
        },
        { timeout: 30_000, intervals: [2_000] },
      )
      .toBe(true);
    await page.getByTestId('notifications-link').click();
    await page
      .getByRole('link', { name: `Application ${reference} received — please pay the fee` })
      .click();
    await expect(page.getByTestId('reference')).toHaveText(reference);

    // HTML + text email with the reference and a portal link, no ID number.
    await expect
      .poll(
        async () => {
          const res = await request.get(`${MAILPIT}/api/v1/search`, {
            params: { query: `to:"${email}" subject:"${reference}"`, limit: '1' },
          });
          return ((await res.json()) as { messages: { ID: string }[] }).messages[0]?.ID ?? null;
        },
        { timeout: 20_000 },
      )
      .not.toBeNull();
    const search = await request.get(`${MAILPIT}/api/v1/search`, {
      params: { query: `to:"${email}" subject:"${reference}"`, limit: '1' },
    });
    const id = ((await search.json()) as { messages: { ID: string }[] }).messages[0]!.ID;
    const message = (await (await request.get(`${MAILPIT}/api/v1/message/${id}`)).json()) as {
      Text: string;
      HTML: string;
    };
    expect(message.HTML).toContain(reference);
    expect(message.Text).toContain('/citizen/applications/');
    expect(`${message.Text}${message.HTML}`).not.toContain('SO1234567');
  });
});
