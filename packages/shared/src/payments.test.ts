import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assessFee, MAX_EXTRA_COPIES } from './fees.js';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  canonicalize,
  maskName,
  SubmitManualPaymentRequestSchema,
  verifySignature,
} from './payments.js';

describe('fee engine properties (FR-040)', () => {
  const cents = fc.bigInt({ min: 0n, max: 10_000_000n });
  it('should always total base + perCopy × copies in exact cents and never go negative', () => {
    fc.assert(
      fc.property(
        cents,
        cents,
        fc.integer({ min: 0, max: MAX_EXTRA_COPIES }),
        (base, perCopy, copies) => {
          const r = assessFee({ baseCents: base, perCopyCents: perCopy }, copies);
          expect(r.totalCents).toBe(base + perCopy * BigInt(copies));
          expect(r.totalCents).toBe(r.lines.reduce((s, l) => s + l.amountCents, 0n));
          expect(r.totalCents >= 0n).toBe(true);
        },
      ),
    );
  });

  it('should reject any copy count outside 0–5', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer({ max: -1 }), fc.integer({ min: MAX_EXTRA_COPIES + 1 })),
        (copies) => {
          expect(() => assessFee({ baseCents: 100n, perCopyCents: 10n }, copies)).toThrow(
            RangeError,
          );
        },
      ),
    );
  });
});

describe('canonicalize (JCS for string-only objects)', () => {
  it('should sort keys and escape strings deterministically', () => {
    expect(canonicalize({ no: 'R-2026-000001', amt: '1500', h: 'Amina "H***"' })).toBe(
      '{"amt":"1500","h":"Amina \\"H***\\"","no":"R-2026-000001"}',
    );
  });

  it('should not depend on insertion order', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.string()), (obj) => {
        const reversed = Object.fromEntries(Object.entries(obj).reverse());
        expect(canonicalize(reversed)).toBe(canonicalize(obj));
        expect(JSON.parse(canonicalize(obj))).toEqual(obj);
      }),
    );
  });
});

describe('maskName', () => {
  it.each([
    ['Amina Hassan Warsame', 'Amina H*** W***'],
    ['  Ahmed   mohamed ', 'Ahmed M***'],
    ['Hodan', 'Hodan'],
  ])('should mask %s as %s', (input, expected) => {
    expect(maskName(input)).toBe(expected);
  });
});

describe('verifySignature (Ed25519 over canonical JSON)', () => {
  const payload = {
    t: 'RCPT',
    no: 'R-2026-000001',
    svc: 'Police clearance',
    iss: '2026-10-13T12:00:00.000Z',
    h: 'Amina H***',
    amt: '1500',
    kid: 'k1',
  };

  async function signed() {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const sig = new Uint8Array(
      await crypto.subtle.sign(
        { name: 'Ed25519' },
        pair.privateKey,
        new TextEncoder().encode(canonicalize(payload)),
      ),
    );
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    return { sig: bytesToBase64Url(sig), pub: bytesToBase64Url(raw) };
  }

  it('should accept the genuine signature', async () => {
    const { sig, pub } = await signed();
    expect(await verifySignature(payload, sig, pub)).toBe('VALID');
  });

  it('should reject a tampered amount, a tampered signature and the wrong key', async () => {
    const { sig, pub } = await signed();
    const other = await signed();
    expect(await verifySignature({ ...payload, amt: '150000' }, sig, pub)).toBe('INVALID');
    // Flip one bit of the decoded signature (editing base64 text can land in padding bits).
    const flipped = base64UrlToBytes(sig);
    flipped[10] = flipped[10]! ^ 0x01;
    expect(await verifySignature(payload, bytesToBase64Url(flipped), pub)).toBe('INVALID');
    expect(await verifySignature(payload, sig, other.pub)).toBe('INVALID');
  });
});

describe('SubmitManualPaymentRequestSchema', () => {
  const base = {
    channel: 'MOBILE_MONEY',
    provider: 'EVC_PLUS',
    reference: 'TX12345',
    amountCents: '1500',
    paidAt: '2026-10-13',
  };
  it('should accept whole cents and refuse floats, zero and unknown wallets', () => {
    expect(SubmitManualPaymentRequestSchema.safeParse(base).success).toBe(true);
    expect(
      SubmitManualPaymentRequestSchema.safeParse({ ...base, amountCents: '15.00' }).success,
    ).toBe(false);
    expect(SubmitManualPaymentRequestSchema.safeParse({ ...base, amountCents: 1500 }).success).toBe(
      false,
    );
    expect(SubmitManualPaymentRequestSchema.safeParse({ ...base, amountCents: '0' }).success).toBe(
      false,
    );
    expect(
      SubmitManualPaymentRequestSchema.safeParse({ ...base, provider: 'PAYPAL' }).success,
    ).toBe(false);
    expect(
      SubmitManualPaymentRequestSchema.safeParse({
        ...base,
        channel: 'BANK',
        provider: 'Salaam Bank',
      }).success,
    ).toBe(true);
  });
});
