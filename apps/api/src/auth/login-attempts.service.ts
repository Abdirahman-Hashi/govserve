import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { AUTH_POLICY } from './auth.constants';

const key = (userId: string, ip: string | null) => `auth:login-failures:${userId}:${ip ?? '-'}`;

/**
 * Failed sign-ins per account and source address (FR-004). Blocking the source after a few
 * failures stops guessing without letting a stranger lock the real owner out; the account-wide
 * lock (lockout.ts) is the backstop for guessing from many addresses.
 */
@Injectable()
export class LoginAttemptsService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async isBlocked(userId: string, ip: string | null): Promise<boolean> {
    await this.ensureConnected();
    const count = Number((await this.redis.get(key(userId, ip))) ?? 0);
    return count >= AUTH_POLICY.lockout.maxFailuresPerSource;
  }

  /** Counts one failure; the window starts at the first failure. Returns the new count. */
  async recordFailure(userId: string, ip: string | null): Promise<number> {
    await this.ensureConnected();
    const k = key(userId, ip);
    const [[, count]] = (await this.redis
      .multi()
      .incr(k)
      .expire(k, AUTH_POLICY.lockout.windowMinutes * 60, 'NX')
      .exec()) as [[Error | null, number]];
    return count;
  }

  async clear(userId: string, ip: string | null): Promise<void> {
    await this.ensureConnected();
    await this.redis.del(key(userId, ip));
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
  }
}
