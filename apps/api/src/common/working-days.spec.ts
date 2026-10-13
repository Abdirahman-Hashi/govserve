import { addWorkingDays, mogadishuDate } from './working-days';

const SAT_TO_THU = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU'];

describe('addWorkingDays', () => {
  it('should skip Fridays in a Saturday–Thursday week', () => {
    // Thursday 2026-10-15 10:00 Mogadishu → +1 working day skips Friday → Saturday 17th.
    const due = addWorkingDays(new Date('2026-10-15T07:00:00Z'), 1, SAT_TO_THU, new Set());
    expect(mogadishuDate(due)).toBe('2026-10-17');
    expect(due.toISOString()).toBe('2026-10-17T20:59:59.999Z');
  });

  it('should skip public holidays', () => {
    const due = addWorkingDays(
      new Date('2026-06-29T07:00:00Z'),
      3,
      SAT_TO_THU,
      new Set(['2026-07-01']),
    );
    // Tue 30 Jun, (Wed 1 Jul holiday), Thu 2 Jul, (Fri 3), Sat 4 Jul.
    expect(mogadishuDate(due)).toBe('2026-07-04');
  });

  it('should use the Mogadishu date near midnight UTC', () => {
    // 22:30 UTC on Wednesday is already Thursday 01:30 in Mogadishu.
    const due = addWorkingDays(new Date('2026-10-14T22:30:00Z'), 1, SAT_TO_THU, new Set());
    expect(mogadishuDate(due)).toBe('2026-10-17');
  });
});
