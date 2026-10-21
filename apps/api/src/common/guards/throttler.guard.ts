import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerRequest,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { type Request } from 'express';
import { REFRESH_COOKIE } from '../../auth/auth.constants';
import { hashToken, TokenService } from '../../auth/token.service';
import { PrismaService } from '../../prisma/prisma.service';
import { isPublic } from './jwt-auth.guard';

/** Paths whose limit follows the session cookie rather than the IP. */
const SESSION_PATHS = new Set(['/api/v1/auth/refresh', '/api/v1/auth/logout']);

/**
 * Global guard 0: rate limits, counted per endpoint and per caller (NFR-001).
 *
 * Many citizens share one public IP behind carrier NAT, so the main ("default") limits follow
 * the caller, not the address:
 * - signed-in requests count per account (a valid access token's subject);
 * - session refresh and logout count per session (the refresh token's family, which survives
 *   rotation; an unknown token counts per IP);
 * - public endpoints (sign-in, registration, codes, verification) and anything without a valid
 *   token count per IP, so guessing and enumeration stay limited by address.
 * A second "ip" limit is a coarse per-address ceiling on every endpoint, so rotating tokens or
 * cookies cannot escape limits altogether.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {
    super(options, storage, reflector);
  }

  /**
   * A refresh or logout without a session cookie is answered with 401 at once (every anonymous
   * page load sends one), so only the per-IP ceiling counts it; otherwise anonymous visitors behind
   * one carrier NAT would throttle each other.
   */
  protected override async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    if (props.throttler.name === 'default') {
      const req = props.context.switchToHttp().getRequest<Request>();
      const cookies = (req as { cookies?: Record<string, string | undefined> }).cookies;
      if (SESSION_PATHS.has(req.path) && !cookies?.[REFRESH_COOKIE]) return true;
    }
    return super.handleRequest(props);
  }

  protected override async getTracker(
    req: Record<string, unknown>,
    context?: ExecutionContext,
  ): Promise<string> {
    const r = req as unknown as Request;
    const cookies = (req as { cookies?: Record<string, string | undefined> }).cookies;
    const ip = `ip:${r.ip ?? 'unknown'}`;
    if (context && isPublic(this.reflector, context)) {
      const cookie = cookies?.[REFRESH_COOKIE];
      if (cookie && SESSION_PATHS.has(r.path)) {
        const row = await this.prisma.refreshToken.findUnique({
          where: { tokenHash: hashToken(cookie) },
          select: { familyId: true },
        });
        if (row) return `session:${row.familyId}`;
      }
      return ip;
    }
    const [scheme, token] = (r.get('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) return ip;
    const claims = await this.tokens.verifyAccess(token).catch(() => null);
    return claims ? `user:${claims.sub}` : ip;
  }
}

/** Per-address tracker for the "ip" ceiling. */
export const ipTracker = (req: Record<string, unknown>): string =>
  `ip:${(req as unknown as Request).ip ?? 'unknown'}`;
