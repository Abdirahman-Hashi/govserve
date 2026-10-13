import { randomBytes } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { type CookieOptions, type Request, type Response } from 'express';
import { type AppConfig } from '../config/config.module';
import { AUTH_POLICY, DEVICE_COOKIE, REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './auth.constants';

function base(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  };
}

export function setRefreshCookie(
  res: Response,
  config: AppConfig,
  token: string,
  expires: Date,
): void {
  res.cookie(REFRESH_COOKIE, token, { ...base(config), expires });
}

export function clearRefreshCookie(res: Response, config: AppConfig): void {
  res.clearCookie(REFRESH_COOKIE, base(config));
}

export function readCookie(req: Request, name: string): string | undefined {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : undefined;
}

/** Returns this browser's device ID, minting (and setting) one if absent (FR-008). */
export function ensureDeviceId(req: Request, res: Response, config: AppConfig): string {
  const existing = readCookie(req, DEVICE_COOKIE);
  if (existing) return existing;
  const id = randomBytes(24).toString('base64url');
  res.cookie(DEVICE_COOKIE, id, {
    ...base(config),
    maxAge: AUTH_POLICY.trustedDeviceDays * 86_400_000,
  });
  return id;
}

/**
 * CSRF defence for cookie-authenticated endpoints (NFR-001): in addition to SameSite=Strict,
 * a browser request must come from the web app's origin.
 */
export function assertTrustedOrigin(req: Request, config: AppConfig): void {
  const origin = req.get('origin');
  if (origin !== undefined && origin !== new URL(config.WEB_ORIGIN).origin) {
    throw new ForbiddenException({ code: 'BAD_ORIGIN', message: 'Request origin not allowed' });
  }
}
