import { AUTH_POLICY } from './auth.constants';
import { afterFailure, isLocked, type LockoutState } from './lockout';

const MAX = AUTH_POLICY.lockout.maxFailures; // 20 (FR-004)

const t0 = new Date('2026-10-13T10:00:00Z');
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
const fresh: LockoutState = { failedLoginCount: 0, failedLoginAt: null, lockedUntil: null };

function failTimes(n: number, start: LockoutState = fresh, minuteStep = 1) {
  let state = start;
  let justLocked = false;
  for (let i = 0; i < n; i++) ({ justLocked, ...state } = afterFailure(state, at(i * minuteStep)));
  return { state, justLocked };
}

describe('lockout', () => {
  it('should not lock the account one failure short of the limit within 15 minutes', () => {
    const { state, justLocked } = failTimes(MAX - 1, fresh, 0.5);
    expect(justLocked).toBe(false);
    expect(isLocked(state, at(MAX))).toBe(false);
  });

  it('should lock the account for 15 minutes on the 20th failure within 15 minutes', () => {
    const { state, justLocked } = failTimes(MAX, fresh, 0.5);
    expect(justLocked).toBe(true);
    expect(isLocked(state, at(MAX / 2))).toBe(true);
    expect(isLocked(state, at((MAX - 1) / 2 + 15))).toBe(false);
  });

  it('should restart the count when failures are more than 15 minutes apart', () => {
    const { state, justLocked } = failTimes(MAX, fresh, 16);
    expect(justLocked).toBe(false);
    expect(state.failedLoginCount).toBe(1);
  });

  it('should start counting again from 1 after a lock expires', () => {
    const { state } = failTimes(MAX, fresh, 0.5);
    const after = afterFailure(state, at(30));
    expect(after.failedLoginCount).toBe(1);
    expect(after.justLocked).toBe(false);
  });
});
