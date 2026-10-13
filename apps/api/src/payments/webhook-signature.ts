import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-govserve-signature';
export const TOLERANCE_SECONDS = 300;

/** Header value: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.rawBody">`. */
export function signWebhook(
  secret: string,
  rawBody: string | Buffer,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

export type SignatureResult = 'OK' | 'MISSING' | 'MALFORMED' | 'STALE' | 'MISMATCH';

/** Verifies a gateway webhook (timing-safe, ±5 min to limit replays). */
export function verifyWebhook(
  secret: string,
  rawBody: Buffer | undefined,
  header: string | undefined,
  now = Date.now(),
): SignatureResult {
  if (!header || !rawBody) return 'MISSING';
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.trim().split('=') as [string, string]),
  );
  const t = Number(parts['t']);
  const v1 = parts['v1'];
  if (!Number.isInteger(t) || !v1 || !/^[a-f0-9]{64}$/.test(v1)) return 'MALFORMED';
  if (Math.abs(now / 1000 - t) > TOLERANCE_SECONDS) return 'STALE';
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  const given = Buffer.from(v1, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected) ? 'OK' : 'MISMATCH';
}
