import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { type DepartmentCode, type Role } from '@govserve/shared';
import { type RequestContext } from '../common/request-context';
import { type Prisma } from '../generated/prisma/client';
import { AUTH_POLICY } from './auth.constants';
import { type AccessClaims } from './auth.types';

type Db = Prisma.TransactionClient;

export interface TokenSubject {
  id: string;
  role: Role;
  departmentId: string | null;
  departmentCode: DepartmentCode | null;
}

export interface IssuedRefresh {
  token: string;
  familyId: string;
  expiresAt: Date;
}

export type RotateResult =
  | { status: 'OK'; userId: string; refresh: IssuedRefresh }
  | { status: 'INVALID' }
  | { status: 'REUSED'; userId: string; familyId: string };

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('base64url');

/** JWT access tokens + rotating opaque refresh tokens with reuse detection (ADR-0003). */
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccess(subject: TokenSubject, sid: string): Promise<string> {
    const claims: AccessClaims = {
      sub: subject.id,
      role: subject.role,
      dept: subject.departmentId,
      deptCode: subject.departmentCode,
      sid,
    };
    return this.jwt.signAsync(claims, { expiresIn: AUTH_POLICY.accessTokenTtlSeconds });
  }

  verifyAccess(token: string): Promise<AccessClaims> {
    return this.jwt.verifyAsync<AccessClaims>(token);
  }

  /** Starts a new family (login) or continues one (rotation). */
  async issueRefresh(
    db: Db,
    userId: string,
    ctx: RequestContext,
    familyId: string = randomUUID(),
    now = new Date(),
  ): Promise<IssuedRefresh> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + AUTH_POLICY.refreshTokenTtlDays * 86_400_000);
    await db.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: hashToken(token),
        expiresAt,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    });
    return { token, familyId, expiresAt };
  }

  /**
   * Exchanges a refresh token for a new one in the same family. Presenting a token that was
   * revoked, or rotated more than refreshReuseGraceSeconds ago, is treated as theft: the whole
   * family is revoked.
   */
  async rotate(
    db: Db,
    token: string,
    ctx: RequestContext,
    now = new Date(),
  ): Promise<RotateResult> {
    const row = await db.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row) return { status: 'INVALID' };
    const reused = () =>
      this.revokeFamily(db, row.familyId, 'REUSE_DETECTED', now).then(
        () => ({ status: 'REUSED', userId: row.userId, familyId: row.familyId }) as const,
      );
    const inGrace = (rotatedAt: Date) =>
      now.getTime() - rotatedAt.getTime() <= AUTH_POLICY.refreshReuseGraceSeconds * 1000;
    if (row.revokedAt) return reused();
    if (row.expiresAt <= now) return { status: 'INVALID' };
    if (row.rotatedAt) {
      // Another tab rotated it a moment ago: continue the same session instead of revoking it.
      if (!inGrace(row.rotatedAt)) return reused();
    } else {
      // Conditional update: of two concurrent rotations with the same token, only one wins;
      // the other is within the grace period by definition.
      const claimed = await db.refreshToken.updateMany({
        where: { id: row.id, rotatedAt: null, revokedAt: null },
        data: { rotatedAt: now },
      });
      if (claimed.count !== 1) {
        const current = await db.refreshToken.findUnique({ where: { id: row.id } });
        if (!current?.rotatedAt || current.revokedAt || !inGrace(current.rotatedAt))
          return reused();
      }
    }
    const refresh = await this.issueRefresh(db, row.userId, ctx, row.familyId, now);
    return { status: 'OK', userId: row.userId, refresh };
  }

  /** Revokes one session (logout). Returns the owning user, if the token was known. */
  async revokeByToken(
    db: Db,
    token: string,
    reason: string,
    now = new Date(),
  ): Promise<{ userId: string; familyId: string } | null> {
    const row = await db.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row) return null;
    await this.revokeFamily(db, row.familyId, reason, now);
    return { userId: row.userId, familyId: row.familyId };
  }

  async revokeFamily(db: Db, familyId: string, reason: string, now = new Date()): Promise<void> {
    await db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
  }

  async revokeAllForUser(db: Db, userId: string, reason: string, now = new Date()): Promise<void> {
    await db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
  }
}
