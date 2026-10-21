/** Authentication policy (FR-001–FR-009, ADR-0003). Change here, not inline. */
export const AUTH_POLICY = {
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlDays: 14,
  /**
   * A token rotated this recently may be presented once more (two tabs refreshing at the same
   * moment send the same cookie); after that, replay counts as theft and revokes the family.
   */
  refreshReuseGraceSeconds: 10,
  otpTtlMinutes: 10,
  otpMaxAttempts: 5,
  otpResendCooldownSeconds: 60,
  /**
   * Per email and purpose, over 24 h (ASVS 2.7/2.8): codes issued, and wrong guesses across all of
   * them. Without these, asking for a new code every minute allowed endless guessing. Counted per
   * source address first, so a stranger cannot use up the owner's codes; the address-wide caps
   * are the backstop for guessing from many addresses (30 guesses a day: 1 in 33,000).
   */
  otpCodesPerSource: 5,
  otpFailuresPerSource: 10,
  otpDailyCodes: 20,
  otpDailyFailures: 30,
  /**
   * FR-004: 5 failures from one address block that address for the account; 20 from anywhere lock
   * the account itself (so a stranger cannot lock the owner out with a few guesses).
   */
  lockout: { maxFailuresPerSource: 5, maxFailures: 20, windowMinutes: 15, lockMinutes: 15 },
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
