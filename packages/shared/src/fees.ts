import type { Cents } from './money.js';

/** Fee rule of a ServiceVersion (FR-040). */
export interface FeeRule {
  baseCents: Cents;
  perCopyCents: Cents;
}

export const MAX_EXTRA_COPIES = 5;

export interface FeeLine {
  code: 'BASE' | 'COPY';
  qty: number;
  unitCents: Cents;
  amountCents: Cents;
}

export interface FeeAssessmentResult {
  lines: FeeLine[];
  totalCents: Cents;
}

function assertRule(rule: FeeRule): void {
  if (rule.baseCents < 0n || rule.perCopyCents < 0n) {
    throw new RangeError('Fee amounts must not be negative');
  }
}

function assertCount(n: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new RangeError(`${label} must be an integer between ${min} and ${max}`);
  }
}

/** Standard application: base + perCopy × extraCopies (FR-040). */
export function assessFee(rule: FeeRule, extraCopies: number): FeeAssessmentResult {
  assertRule(rule);
  assertCount(extraCopies, 0, MAX_EXTRA_COPIES, 'extraCopies');
  const lines: FeeLine[] = [
    { code: 'BASE', qty: 1, unitCents: rule.baseCents, amountCents: rule.baseCents },
  ];
  if (extraCopies > 0) {
    lines.push({
      code: 'COPY',
      qty: extraCopies,
      unitCents: rule.perCopyCents,
      amountCents: rule.perCopyCents * BigInt(extraCopies),
    });
  }
  return { lines, totalCents: lines.reduce((sum, l) => sum + l.amountCents, 0n) };
}

/** Duplicate certificate: perCopy × copies, at least one copy (FR-042). */
export function assessDuplicateFee(rule: FeeRule, copies: number): FeeAssessmentResult {
  assertRule(rule);
  assertCount(copies, 1, MAX_EXTRA_COPIES, 'copies');
  const amountCents = rule.perCopyCents * BigInt(copies);
  return {
    lines: [{ code: 'COPY', qty: copies, unitCents: rule.perCopyCents, amountCents }],
    totalCents: amountCents,
  };
}
