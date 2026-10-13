import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PASSWORD_MIN_LENGTH } from '@govserve/shared';
import * as argon2 from 'argon2';

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations, 1 lane).
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  private readonly common: Set<string>;
  /** Verified against when the user does not exist, so timing does not reveal accounts. */
  private dummyHash: Promise<string> | undefined;

  constructor() {
    const raw = readFileSync(join(__dirname, 'data', 'common-passwords.txt'), 'utf8');
    this.common = new Set(
      raw
        .split(/\r?\n/)
        .map((p) => p.trim().toLowerCase())
        .filter((p) => p.length >= PASSWORD_MIN_LENGTH),
    );
  }

  /** Length rules are in the shared schema; this adds the server-only checks (FR-003). */
  assertAcceptable(password: string, context: { email?: string; fullName?: string } = {}): void {
    const lower = password.toLowerCase();
    const emailLocal = context.email?.split('@')[0]?.toLowerCase();
    const reasons: string[] = [];
    if (this.common.has(lower)) reasons.push('This password is too common');
    if (emailLocal && emailLocal.length >= 4 && lower.includes(emailLocal)) {
      reasons.push('Do not use your email address in your password');
    }
    if (/^(.)\1+$/.test(password)) reasons.push('Do not repeat a single character');
    if (reasons.length > 0) {
      throw new UnprocessableEntityException({
        code: 'WEAK_PASSWORD',
        message: 'Choose a stronger password',
        details: reasons.map((message) => ({ path: 'password', message })),
      });
    }
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verify(hash: string | null | undefined, password: string): Promise<boolean> {
    if (!hash) {
      this.dummyHash ??= this.hash('dummy-password-for-timing');
      await argon2.verify(await this.dummyHash, password).catch(() => false);
      return false;
    }
    return argon2.verify(hash, password).catch(() => false);
  }
}
