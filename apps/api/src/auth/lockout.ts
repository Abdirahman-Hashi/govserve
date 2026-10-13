import { AUTH_POLICY } from './auth.constants';

export interface LockoutState {
  failedLoginCount: number;
  failedLoginAt: Date | null;
  lockedUntil: Date | null;
}

/** FR-004: true while a lock from earlier failures is still in force. */
export function isLocked(state: LockoutState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil > now;
}

/**
 * State after one more failed login. Failures older than the window start a new count;
 * reaching the limit locks the account for `lockMinutes`.
 */
export function afterFailure(
  state: LockoutState,
  now: Date,
): LockoutState & { justLocked: boolean } {
  const { maxFailures, windowMinutes, lockMinutes } = AUTH_POLICY.lockout;
  const windowStart = new Date(now.getTime() - windowMinutes * 60_000);
  const inWindow =
    state.failedLoginAt !== null && state.failedLoginAt > windowStart && !lockExpired(state, now);
  const failedLoginCount = inWindow ? state.failedLoginCount + 1 : 1;
  const justLocked = failedLoginCount >= maxFailures;
  return {
    failedLoginCount: justLocked ? 0 : failedLoginCount,
    failedLoginAt: now,
    lockedUntil: justLocked ? new Date(now.getTime() + lockMinutes * 60_000) : state.lockedUntil,
    justLocked,
  };
}

export const AFTER_SUCCESS: LockoutState = {
  failedLoginCount: 0,
  failedLoginAt: null,
  lockedUntil: null,
};

function lockExpired(state: LockoutState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil <= now;
}
