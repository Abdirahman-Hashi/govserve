import { describe, expect, it } from 'vitest';
import { assessDuplicateFee, assessFee } from './fees.js';

const rule = { baseCents: 1000n, perCopyCents: 200n };

describe('assessFee', () => {
  it.each([
    [0, 1000n],
    [1, 1200n],
    [5, 2000n],
  ])('should total exact cents when extraCopies is %i', (copies, total) => {
    expect(assessFee(rule, copies).totalCents).toBe(total);
  });

  it('should return only a BASE line when there are no extra copies', () => {
    expect(assessFee(rule, 0).lines).toEqual([
      { code: 'BASE', qty: 1, unitCents: 1000n, amountCents: 1000n },
    ]);
  });

  it('should return zero when the fee rule is zero', () => {
    expect(assessFee({ baseCents: 0n, perCopyCents: 0n }, 3).totalCents).toBe(0n);
  });

  it.each([-1, 6, 1.5])('should reject extraCopies of %s', (copies) => {
    expect(() => assessFee(rule, copies)).toThrow(RangeError);
  });

  it('should reject a negative fee rule', () => {
    expect(() => assessFee({ baseCents: -1n, perCopyCents: 0n }, 0)).toThrow(RangeError);
  });
});

describe('assessDuplicateFee', () => {
  it('should charge perCopy × copies when ordering duplicates', () => {
    expect(assessDuplicateFee(rule, 2).totalCents).toBe(400n);
  });

  it('should reject zero copies when ordering duplicates', () => {
    expect(() => assessDuplicateFee(rule, 0)).toThrow(RangeError);
  });
});
