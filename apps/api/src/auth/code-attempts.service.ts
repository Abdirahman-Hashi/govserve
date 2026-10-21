import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CryptoService } from '../crypto/crypto.service';
import { type OtpPurpose } from '../generated/prisma/client';
import { REDIS } from '../redis/redis.module';

export type CodeCounter = 'issued' | 'failed';

const WINDOW_SECONDS = 24 * 60 * 60;

/**
 * Email codes issued and wrong guesses per email, purpose and source address over 24 h (ASVS
 * 2.7/2.8). Like the sign-in block (LoginAttemptsService), this stops guessing from one address
 * without letting a stranger use up the owner's codes; OtpService keeps address-wide backstops.
 * Kept outside the database transaction, so a rolled-back request still counts.
 */
@Injectable()
export class CodeAttemptsService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly crypto: CryptoService,
  ) {}

  async count(
    counter: CodeCounter,
    email: string,
    purpose: OtpPurpose,
    source: string | null,
  ): Promise<number> {
    await this.ensureConnected();
    return Number((await this.redis.get(this.key(counter, email, purpose, source))) ?? 0);
  }

  /** Counts one; the window starts at the first. */
  async add(
    counter: CodeCounter,
    email: string,
    purpose: OtpPurpose,
    source: string | null,
  ): Promise<void> {
    await this.ensureConnected();
    const k = this.key(counter, email, purpose, source);
    await this.redis.multi().incr(k).expire(k, WINDOW_SECONDS, 'NX').exec();
  }

  /** The email and address are hashed so neither is stored in Redis. */
  private key(counter: CodeCounter, email: string, purpose: OtpPurpose, source: string | null) {
    const id = this.crypto.keyedHash(
      'code-limit',
      `${purpose}:${email.toLowerCase()}:${source ?? '-'}`,
    );
    return `auth:code-${counter}:${id}`;
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
  }
}
