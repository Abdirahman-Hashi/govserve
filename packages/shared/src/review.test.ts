import { describe, expect, it } from 'vitest';
import { normaliseName, slaRisk } from './review.js';

const h = (hours: number) => new Date(Date.UTC(2026, 9, 1) + hours * 3_600_000);

describe('slaRisk', () => {
  const base = { queuedAt: h(0), slaDueAt: h(100), pausedAt: null, pausedTotalMs: 0 };
  it.each([
    [10, 'ON_TRACK'],
    [79, 'ON_TRACK'],
    [80, 'AT_RISK'],
    [99, 'AT_RISK'],
    [100, 'OVERDUE'],
    [150, 'OVERDUE'],
  ])('should be %s hours in → %s', (hours, risk) => {
    expect(slaRisk({ ...base, now: h(hours) })).toBe(risk);
  });

  it('should report PAUSED while paused and not count paused time', () => {
    expect(slaRisk({ ...base, pausedAt: h(50), now: h(90) })).toBe('PAUSED');
    // 20 h were paused and the due date moved 20 h later: 90 h in is 70 % of the 100 h budget.
    expect(slaRisk({ ...base, slaDueAt: h(120), pausedTotalMs: 20 * 3_600_000, now: h(90) })).toBe(
      'ON_TRACK',
    );
  });

  it('should be NONE before the application is queued', () => {
    expect(slaRisk({ ...base, queuedAt: null, now: h(1) })).toBe('NONE');
  });
});

describe('normaliseName', () => {
  it('should ignore case, extra spaces, punctuation and accents', () => {
    expect(normaliseName('  amina   hassan-warsame ')).toBe(normaliseName('AMINA HASSAN WARSAME'));
    expect(normaliseName('Hodán')).toBe('HODAN');
  });
});
