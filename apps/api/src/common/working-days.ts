const DAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const TZ_OFFSET_MS = 3 * 3_600_000; // Africa/Mogadishu, UTC+3 all year (no DST)

/** Calendar date (YYYY-MM-DD) in Mogadishu for an instant. */
export function mogadishuDate(instant: Date): string {
  return new Date(instant.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Adds working days (FR-080): skips days outside the working week and public holidays.
 * Counting starts the next calendar day; the result is the end of that working day in Mogadishu.
 */
export function addWorkingDays(
  start: Date,
  days: number,
  workingWeek: readonly string[],
  holidays: ReadonlySet<string>,
): Date {
  if (workingWeek.length === 0) throw new Error('The working week must have at least one day');
  const working = new Set(workingWeek);
  let cursor = new Date(`${mogadishuDate(start)}T00:00:00.000Z`);
  let remaining = days;
  while (remaining > 0) {
    cursor = new Date(cursor.getTime() + 86_400_000);
    const iso = cursor.toISOString().slice(0, 10);
    if (working.has(DAY_CODES[cursor.getUTCDay()]!) && !holidays.has(iso)) remaining -= 1;
  }
  // 23:59:59.999 Mogadishu time on the final working day.
  return new Date(cursor.getTime() + 86_400_000 - 1 - TZ_OFFSET_MS);
}
