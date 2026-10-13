/**
 * Money is USD in integer cents, always `bigint`. Never use floats.
 * JSON carries cents as a decimal string (bigint is not JSON-serialisable).
 */
export type Cents = bigint;

const CENTS_STRING = /^-?\d+$/;

/** Parse a cents string (as sent over JSON) into bigint cents. */
export function parseCents(value: string): Cents {
  if (!CENTS_STRING.test(value)) {
    throw new TypeError(`Invalid cents value: ${JSON.stringify(value)}`);
  }
  return BigInt(value);
}

/** Serialise cents for JSON. */
export function centsToString(cents: Cents): string {
  return cents.toString();
}

/** Format cents for display, e.g. 123456n → "$1,234.56". Display only. */
export function formatUsd(cents: Cents): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const dollars = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const rest = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}$${dollars}.${rest}`;
}

/**
 * Cents as a plain number for chart geometry only (bar heights, axis positions). Exact up to
 * 2^53 cents; anything larger throws rather than silently losing precision. Never use the result
 * for arithmetic or display — label values with `formatUsd` on the bigint.
 */
export function centsForChart(cents: Cents): number {
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('Amount too large to chart exactly');
  }
  return Number(cents);
}
