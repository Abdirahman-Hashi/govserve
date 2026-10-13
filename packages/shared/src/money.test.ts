import { describe, expect, it } from 'vitest';
import { centsForChart, centsToString, formatUsd, parseCents } from './money.js';

describe('money', () => {
  it('should round-trip cents through strings when serialising', () => {
    expect(parseCents(centsToString(123456n))).toBe(123456n);
  });

  it('should reject decimals when parsing cents', () => {
    expect(() => parseCents('10.50')).toThrow(TypeError);
    expect(() => parseCents('')).toThrow(TypeError);
  });

  it.each([
    [0n, '$0.00'],
    [5n, '$0.05'],
    [100n, '$1.00'],
    [123456n, '$1,234.56'],
    [100000000n, '$1,000,000.00'],
    [-2550n, '-$25.50'],
  ])('should format %s cents as %s', (cents, expected) => {
    expect(formatUsd(cents)).toBe(expected);
  });
});

describe('centsForChart', () => {
  it('should convert exactly within the safe range and refuse beyond it', () => {
    expect(centsForChart(123456n)).toBe(123456);
    expect(centsForChart(-5n)).toBe(-5);
    expect(() => centsForChart(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(RangeError);
  });
});
