/** Authentication policy (FR-001–FR-009, ADR-0003). Change here, not inline. */
export const AUTH_POLICY = {
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlDays: 14,
  otpTtlMinutes: 10,
  otpMaxAttempts: 5,
  otpResendCooldownSeconds: 60,
  lockout: { maxFailures: 5, windowMinutes: 15, lockMinutes: 15 },
  invitationTtlHours: 72,
  trustedDeviceDays: 30,
  unverifiedAccountTtlDays: 7,
  /** Per-IP limit on credential and code endpoints (NFR-001). */
  authRequestsPerMinute: 10,
  /**
   * Refresh/logout are authenticated by an unguessable cookie, not a guessable secret, and run
   * on every page load; many citizens share one IP behind mobile carrier NAT. A looser limit.
   */
  sessionRequestsPerMinute: 60,
} as const;

export const REFRESH_COOKIE = 'gs_refresh';
export const DEVICE_COOKIE = 'gs_device';
/** Refresh and logout are the only endpoints that read the refresh cookie. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
