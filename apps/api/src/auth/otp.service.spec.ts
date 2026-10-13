import { randomBytes } from 'node:crypto';
import { type AppConfig } from '../config/config.module';
import { CryptoService } from '../crypto/crypto.service';
import { type OtpCode, type Prisma } from '../generated/prisma/client';
import { OtpService } from './otp.service';

/** Minimal in-memory stand-in for the otpCode delegate. */
function fakeDb() {
  const rows: OtpCode[] = [];
  const matches = (r: OtpCode, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v);
  const otpCode = {
    updateMany: jest.fn(
      ({ where, data }: { where: Record<string, unknown>; data: Partial<OtpCode> }) => {
        const hit = rows.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return Promise.resolve({ count: hit.length });
      },
    ),
    create: jest.fn(({ data }: { data: Partial<OtpCode> }) => {
      const row = {
        id: `otp-${rows.length}`,
        attempts: 0,
        consumedAt: null,
        createdAt: new Date(),
        ...data,
      } as OtpCode;
      rows.push(row);
      return Promise.resolve(row);
    }),
    findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve([...rows].reverse().find((r) => matches(r, where)) ?? null),
    ),
    update: jest.fn(
      ({ where, data }: { where: { id: string }; data: { attempts: { increment: number } } }) => {
        const row = rows.find((r) => r.id === where.id)!;
        row.attempts += data.attempts.increment;
        return Promise.resolve(row);
      },
    ),
    count: jest.fn(() => Promise.resolve(rows.length)),
  };
  return { db: { otpCode } as unknown as Prisma.TransactionClient, rows };
}

const crypto = new CryptoService({
  PII_KEYS: [{ id: 'k', key: randomBytes(32) }],
  BLIND_INDEX_KEY: randomBytes(32),
} as unknown as AppConfig);
const service = new OtpService(crypto);
const email = 'amina@example.com';

describe('OtpService', () => {
  it('should store only a hash of the code when issuing', async () => {
    const { db, rows } = fakeDb();
    const { code } = await service.issue(db, { email, purpose: 'VERIFY_EMAIL' });
    expect(code).toMatch(/^\d{6}$/);
    expect(rows[0]!.codeHash).not.toContain(code);
  });

  it('should accept the right code once and reject reuse', async () => {
    const { db } = fakeDb();
    const { code } = await service.issue(db, { email, purpose: 'VERIFY_EMAIL' });
    expect((await service.verify(db, { email, purpose: 'VERIFY_EMAIL', code })).ok).toBe(true);
    expect(await service.verify(db, { email, purpose: 'VERIFY_EMAIL', code })).toEqual({
      ok: false,
      reason: 'INVALID',
    });
  });

  it('should invalidate the previous code when a new one is issued', async () => {
    const { db } = fakeDb();
    const first = await service.issue(db, { email, purpose: 'VERIFY_EMAIL' });
    await service.issue(db, { email, purpose: 'VERIFY_EMAIL' });
    const result = await service.verify(db, {
      email,
      purpose: 'VERIFY_EMAIL',
      code: first.code,
      id: first.id,
    });
    expect(result.ok).toBe(false);
  });

  it('should reject an expired code', async () => {
    const { db } = fakeDb();
    const issuedAt = new Date('2026-10-13T10:00:00Z');
    const { code } = await service.issue(db, { email, purpose: 'VERIFY_EMAIL' }, issuedAt);
    const later = new Date('2026-10-13T10:10:01Z');
    expect(await service.verify(db, { email, purpose: 'VERIFY_EMAIL', code }, later)).toEqual({
      ok: false,
      reason: 'EXPIRED',
    });
  });

  it('should lock the code after 5 wrong attempts even if the right code follows', async () => {
    const { db } = fakeDb();
    const { code } = await service.issue(db, { email, purpose: 'VERIFY_EMAIL' });
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      await service.verify(db, { email, purpose: 'VERIFY_EMAIL', code: wrong });
    expect(await service.verify(db, { email, purpose: 'VERIFY_EMAIL', code })).toEqual({
      ok: false,
      reason: 'TOO_MANY_ATTEMPTS',
    });
  });
});
