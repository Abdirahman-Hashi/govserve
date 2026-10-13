/**
 * Builds a PostgreSQL tsquery ('simple' configuration) from free text: every word must match,
 * in any order, as a prefix ("hod ali" → "hod:* & ali:*"). Only letters and digits survive, so
 * the result is always valid tsquery syntax. Returns null when nothing searchable is left.
 */
export function nameQuery(input: string): string | null {
  const words = input
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 0)
    .slice(0, 6);
  return words.length > 0 ? words.map((w) => `${w}:*`).join(' & ') : null;
}
