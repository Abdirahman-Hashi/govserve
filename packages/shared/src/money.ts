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
