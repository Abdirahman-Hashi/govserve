import { randomBytes } from 'node:crypto';
import { type AppConfig } from '../config/config.module';
import { CryptoService } from '../crypto/crypto.service';
import { type OtpCode, type Prisma } from '../generated/prisma/client';
import { type CodeAttemptsService, type CodeCounter } from './code-attempts.service';
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
    aggregate: jest.fn(() =>
      Promise.resolve({ _sum: { attempts: rows.reduce((n, r) => n + r.attempts, 0) } }),
    ),
  };
  return { db: { otpCode } as unknown as Prisma.TransactionClient, rows };
}

const crypto = new CryptoService({
  PII_KEYS: [{ id: 'k', key: randomBytes(32) }],
  BLIND_INDEX_KEY: randomBytes(32),
} as unknown as AppConfig);
/** In-memory stand-in for the per-source Redis counters. */
function fakeAttempts() {
  const counts = new Map<string, number>();
  const key = (counter: CodeCounter, email: string, purpose: string, source: string | null) =>
    `${counter}:${purpose}:${email}:${source ?? '-'}`;
  return {
    count: (...k: Parameters<typeof key>) => Promise.resolve(counts.get(key(...k)) ?? 0),
    add: (...k: Parameters<typeof key>) => {
      counts.set(key(...k), (counts.get(key(...k)) ?? 0) + 1);
      return Promise.resolve();
    },
  } as unknown as CodeAttemptsService;
}

let service: OtpService;
beforeEach(() => {
  service = new OtpService(crypto, fakeAttempts());
});
const email = 'amina@example.com';
const ip = '203.0.113.7';

describe('OtpService', () => {
  it('should store only a hash of the code when issuing', async () => {
    const { db, rows } = fakeDb();
    const { code } = (await service.issue(db, { email, purpose: 'VERIFY_EMAIL', source: ip }))!;
    expect(code).toMatch(/^\d{6}$/);
    expect(rows[0]!.codeHash).not.toContain(code);
  });

  it('should accept the right code once and reject reuse', async () => {
    const { db } = fakeDb();
    const { code } = (await service.issue(db, { email, purpose: 'VERIFY_EMAIL', source: ip }))!;
    expect(
      (await service.verify(db, { email, purpose: 'VERIFY_EMAIL', code, source: ip })).ok,
    ).toBe(true);
    expect(await service.verify(db, { email, purpose: 'VERIFY_EMAIL', code, source: ip })).toEqual({
      ok: false,
      reason: 'INVALID',
    });
  });

  it('should invalidate the previous code when a new one is issued', async () => {
    const { db } = fakeDb();
    const first = (await service.issue(db, { email, purpose: 'VERIFY_EMAIL', source: ip }))!;
    await service.issue(db, { email, purpose: 'VERIFY_EMAIL', source: ip });
    const result = await service.verify(db, {
      email,
      purpose: 'VERIFY_EMAIL',
      code: first.code,
      id: first.id,
      source: ip,
    });
    expect(result.ok).toBe(false);
  });

  it('should reject an expired code', async () => {
    const { db } = fakeDb();
    const issuedAt = new Date('2026-10-13T10:00:00Z');
    const { code } = (await service.issue(
      db,
      { email, purpose: 'VERIFY_EMAIL', source: ip },
      issuedAt,
    ))!;
    const later = new Date('2026-10-13T10:10:01Z');
    expect(
      await service.verify(db, { email, purpose: 'VERIFY_EMAIL', code, source: ip }, later),
    ).toEqual({
      ok: false,
      reason: 'EXPIRED',
    });
  });

  it('should lock the code after 5 wrong attempts even if the right code follows', async () => {
    const { db } = fakeDb();
    const { code } = (await service.issue(db, { email, purpose: 'VERIFY_EMAIL', source: ip }))!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      await service.verify(db, { email, purpose: 'VERIFY_EMAIL', code: wrong, source: ip });
    expect(await service.verify(db, { email, purpose: 'VERIFY_EMAIL', code, source: ip })).toEqual({
      ok: false,
      reason: 'TOO_MANY_ATTEMPTS',
    });
  });

  const reset = (source: string) => ({ email, purpose: 'RESET_PASSWORD' as const, source });

  /** Five wrong guesses from the source, each on a fresh code. */
  async function guessWrong(db: Prisma.TransactionClient, source: string, rounds: number) {
    for (let round = 0; round < rounds; round++) {
      const { code } = (await service.issue(db, reset(source)))!;
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) await service.verify(db, { ...reset(source), code: wrong });
    }
  }

  it('should stop issuing codes to an address after five that day but still issue to another', async () => {
    const { db } = fakeDb();
    for (let i = 0; i < 5; i++) expect(await service.issue(db, reset(ip))).not.toBeNull();
    expect(await service.issue(db, reset(ip))).toBeNull();
    expect(await service.issue(db, reset('198.51.100.1'))).not.toBeNull();
  });

  it('should stop issuing codes for the email and purpose after twenty that day from any addresses', async () => {
    const { db } = fakeDb();
    for (let n = 0; n < 20; n++)
      expect(await service.issue(db, reset(`198.51.100.${Math.floor(n / 5)}`))).not.toBeNull();
    expect(await service.issue(db, reset('198.51.100.99'))).toBeNull();
  });

  it('should refuse a right code from an address with ten wrong guesses that day but accept it from another', async () => {
    const { db } = fakeDb();
    await guessWrong(db, ip, 2);
    const { code } = (await service.issue(db, reset(ip)))!;
    expect(await service.verify(db, { ...reset(ip), code })).toEqual({
      ok: false,
      reason: 'TOO_MANY_ATTEMPTS',
    });
    expect((await service.verify(db, { ...reset('198.51.100.1'), code })).ok).toBe(true);
  });

  it('should refuse a right code from any address once thirty wrong guesses were made that day', async () => {
    const { db } = fakeDb();
    for (let n = 0; n < 3; n++) await guessWrong(db, `198.51.100.${n}`, 2);
    const { code } = (await service.issue(db, reset('198.51.100.50')))!;
    expect(await service.verify(db, { ...reset('198.51.100.50'), code })).toEqual({
      ok: false,
      reason: 'TOO_MANY_ATTEMPTS',
    });
  });
});
