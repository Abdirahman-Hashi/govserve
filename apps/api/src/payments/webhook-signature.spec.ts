import { signWebhook, verifyWebhook } from './webhook-signature';

const secret = 's'.repeat(40);
const body = Buffer.from('{"id":"evt_1","type":"payment.succeeded"}');
const now = Date.UTC(2026, 9, 13, 12, 0, 0);
const t = Math.floor(now / 1000);

describe('webhook signatures', () => {
  it('should accept a correctly signed, fresh webhook', () => {
    expect(verifyWebhook(secret, body, signWebhook(secret, body, t), now)).toBe('OK');
  });

  it('should reject a body changed after signing', () => {
    const header = signWebhook(secret, body, t);
    expect(
      verifyWebhook(
        secret,
        Buffer.from(body.toString().replace('succeeded', 'failed')),
        header,
        now,
      ),
    ).toBe('MISMATCH');
  });

  it('should reject the wrong secret', () => {
    expect(verifyWebhook(secret, body, signWebhook('x'.repeat(40), body, t), now)).toBe('MISMATCH');
  });

  it('should reject a replay older than five minutes', () => {
    expect(verifyWebhook(secret, body, signWebhook(secret, body, t - 301), now)).toBe('STALE');
    expect(verifyWebhook(secret, body, signWebhook(secret, body, t - 299), now)).toBe('OK');
  });

  it('should reject missing or malformed headers', () => {
    expect(verifyWebhook(secret, body, undefined, now)).toBe('MISSING');
    expect(verifyWebhook(secret, body, 't=abc,v1=zz', now)).toBe('MALFORMED');
    expect(verifyWebhook(secret, body, `t=${t},v1=${'0'.repeat(63)}`, now)).toBe('MALFORMED');
  });
});
