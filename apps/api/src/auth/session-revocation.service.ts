import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { AUTH_POLICY } from './auth.constants';

const key = (userId: string) => `auth:sessions-revoked-at:${userId}`;
const sessionKey = (sid: string) => `auth:session-revoked:${sid}`;

/**
 * Access tokens are stateless for 15 minutes. When a user is deactivated, changes role or
 * resets their password, we record the time so JwtAuthGuard rejects older tokens at once.
 */
@Injectable()
export class SessionRevocationService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async revokeAllBefore(userId: string, now = new Date()): Promise<void> {
    await this.ensureConnected();
    // Tokens carry iat in whole seconds: round up so a token minted this second is rejected too.
    const seconds = Math.ceil(now.getTime() / 1000);
    await this.redis.set(
      key(userId),
      String(seconds),
      'EX',
      AUTH_POLICY.accessTokenTtlSeconds + 60,
    );
  }

  /** Logout of one session: its access tokens stop working at once (ASVS 3.3.1). */
  async revokeSession(sid: string): Promise<void> {
    await this.ensureConnected();
    await this.redis.set(sessionKey(sid), '1', 'EX', AUTH_POLICY.accessTokenTtlSeconds + 60);
  }

  /** True when the user's tokens from before a revocation, or this session, are no longer valid. */
  async isRevoked(userId: string, issuedAtSeconds: number, sid?: string): Promise<boolean> {
    await this.ensureConnected();
    const [userCutoff, session] = await this.redis.mget(key(userId), sessionKey(sid ?? '-'));
    return (userCutoff != null && issuedAtSeconds < Number(userCutoff)) || session != null;
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
  }
}
