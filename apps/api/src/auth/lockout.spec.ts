import { afterFailure, isLocked, type LockoutState } from './lockout';

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
  it('should not lock after 4 failures within 15 minutes', () => {
    const { state, justLocked } = failTimes(4);
    expect(justLocked).toBe(false);
    expect(isLocked(state, at(4))).toBe(false);
  });

  it('should lock for 15 minutes on the 5th failure within 15 minutes', () => {
    const { state, justLocked } = failTimes(5);
    expect(justLocked).toBe(true);
    expect(isLocked(state, at(5))).toBe(true);
    expect(isLocked(state, at(4 + 15))).toBe(false);
  });

  it('should restart the count when failures are more than 15 minutes apart', () => {
    const { state, justLocked } = failTimes(5, fresh, 16);
    expect(justLocked).toBe(false);
    expect(state.failedLoginCount).toBe(1);
  });

  it('should start counting again from 1 after a lock expires', () => {
    const { state } = failTimes(5);
    const after = afterFailure(state, at(30));
    expect(after.failedLoginCount).toBe(1);
    expect(after.justLocked).toBe(false);
  });
});
