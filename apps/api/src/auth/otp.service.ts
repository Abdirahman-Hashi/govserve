import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CryptoService } from '../crypto/crypto.service';
import { type OtpCode, type OtpPurpose, type Prisma } from '../generated/prisma/client';
import { AUTH_POLICY } from './auth.constants';

type Db = Prisma.TransactionClient;

export interface IssuedOtp {
  id: string;
  code: string;
}

export type OtpCheck =
  { ok: true; otp: OtpCode } | { ok: false; reason: 'INVALID' | 'EXPIRED' | 'TOO_MANY_ATTEMPTS' };

/** Six-digit email one-time codes (FR-001, FR-005, FR-008): hashed, 10 min, 5 attempts. */
@Injectable()
export class OtpService {
  constructor(private readonly crypto: CryptoService) {}

  /**
   * Issues a new code and invalidates any earlier unused code for the same email and purpose.
   * Returns null when the daily cap for that email and purpose is reached.
   */
  async issue(
    db: Db,
    input: {
      email: string;
      purpose: OtpPurpose;
      userId?: string | null;
      contextHash?: string | null;
    },
    now = new Date(),
  ): Promise<IssuedOtp | null> {
    const issuedToday = await db.otpCode.count({
      where: { email: input.email, purpose: input.purpose, createdAt: { gt: dayBefore(now) } },
    });
    if (issuedToday >= AUTH_POLICY.otpDailyCodes) return null;
    await db.otpCode.updateMany({
      where: { email: input.email, purpose: input.purpose, consumedAt: null },
      data: { consumedAt: now },
    });
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const otp = await db.otpCode.create({
      data: {
        email: input.email,
        purpose: input.purpose,
        userId: input.userId ?? null,
        contextHash: input.contextHash ?? null,
        codeHash: this.crypto.keyedHash('otp', code),
        expiresAt: new Date(now.getTime() + AUTH_POLICY.otpTtlMinutes * 60_000),
      },
    });
    return { id: otp.id, code };
  }

  /** True when a code for this email and purpose was issued within the resend cooldown. */
  async recentlyIssued(
    db: Db,
    email: string,
    purpose: OtpPurpose,
    now = new Date(),
  ): Promise<boolean> {
    const since = new Date(now.getTime() - AUTH_POLICY.otpResendCooldownSeconds * 1000);
    return (await db.otpCode.count({ where: { email, purpose, createdAt: { gt: since } } })) > 0;
  }

  /**
   * Checks a code against the latest open code for the email and purpose (or a specific
   * challenge ID). Wrong codes use up an attempt; a correct code is consumed exactly once.
   * Callers must let the transaction commit on failure (return, then throw), or the attempt is
   * rolled back and never counts.
   */
  async verify(
    db: Db,
    input: { email?: string; purpose: OtpPurpose; code: string; id?: string; userId?: string },
    now = new Date(),
  ): Promise<OtpCheck> {
    const otp = await db.otpCode.findFirst({
      where: {
        purpose: input.purpose,
        consumedAt: null,
        ...(input.id && { id: input.id }),
        ...(input.email && { email: input.email }),
        ...(input.userId && { userId: input.userId }),
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) return { ok: false, reason: 'INVALID' };
    if (otp.expiresAt <= now) return { ok: false, reason: 'EXPIRED' };
    if (otp.attempts >= AUTH_POLICY.otpMaxAttempts)
      return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };
    const failedToday = await db.otpCode.aggregate({
      where: { email: otp.email, purpose: otp.purpose, createdAt: { gt: dayBefore(now) } },
      _sum: { attempts: true },
    });
    if ((failedToday._sum.attempts ?? 0) >= AUTH_POLICY.otpDailyFailures)
      return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };

    if (!this.crypto.safeEqual(otp.codeHash, this.crypto.keyedHash('otp', input.code))) {
      await db.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      return {
        ok: false,
        reason: otp.attempts + 1 >= AUTH_POLICY.otpMaxAttempts ? 'TOO_MANY_ATTEMPTS' : 'INVALID',
      };
    }
    // Conditional update: two concurrent correct submissions consume the code once.
    const consumed = await db.otpCode.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: now },
    });
    return consumed.count === 1 ? { ok: true, otp } : { ok: false, reason: 'INVALID' };
  }
}

const dayBefore = (now: Date) => new Date(now.getTime() - 86_400_000);
