import { type APIRequestContext, expect } from '@playwright/test';

const MAILPIT = process.env['MAILPIT_URL'] ?? 'http://localhost:8025';

/** Polls Mailpit (dev SMTP sink) for the newest 6-digit code sent to `to`. */
export async function latestCode(request: APIRequestContext, to: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const search = await request.get(`${MAILPIT}/api/v1/search`, {
          params: { query: `to:"${to}"`, limit: '1' },
        });
        const { messages } = (await search.json()) as { messages: { ID: string }[] };
        if (!messages[0]) return undefined;
        const message = await request.get(`${MAILPIT}/api/v1/message/${messages[0].ID}`);
        const { Text } = (await message.json()) as { Text: string };
        code = /\b(\d{6})\b/.exec(Text)?.[1];
        return code;
      },
      { timeout: 10_000 },
    )
    .toMatch(/^\d{6}$/);
  return code!;
}
