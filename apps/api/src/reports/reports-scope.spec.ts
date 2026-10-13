import { ForbiddenException } from '@nestjs/common';
import { type AuthUser } from '../auth/auth.types';
import { type AppConfig } from '../config/config.module';
import { type AuditService } from '../audit/audit.service';
import { type PrismaService } from '../prisma/prisma.service';
import { addDays, dayEnd, dayStart, mogadishuToday, ReportsService } from './reports.service';

const DEPT_A = '0199e0a8-7c1b-7d2e-9f00-00000000000a';
const DEPT_B = '0199e0a8-7c1b-7d2e-9f00-00000000000b';
const user = (role: AuthUser['role'], departmentId: string | null): AuthUser => ({
  id: '0199e0a8-7c1b-7d2e-9f00-000000000001',
  role,
  departmentId,
  departmentCode: null,
  sid: 's',
});
const service = new ReportsService({} as PrismaService, {} as AuditService, {} as AppConfig);
const now = new Date('2026-10-14T22:30:00Z'); // already 15 October in Mogadishu

describe('report scope', () => {
  it('should hold supervisors to their own department, whatever they ask for', () => {
    expect(
      service.scope(user('SUPERVISOR', DEPT_A), { departmentId: DEPT_B }, now).departmentId,
    ).toBe(DEPT_A);
  });

  it('should let admins see all departments or pick one', () => {
    expect(service.scope(user('ADMIN', null), {}, now).departmentId).toBeNull();
    expect(service.scope(user('ADMIN', null), { departmentId: DEPT_B }, now).departmentId).toBe(
      DEPT_B,
    );
  });

  it.each(['OFFICER', 'CITIZEN'] as const)('should refuse %s', (role) => {
    expect(() => service.scope(user(role, DEPT_A), {}, now)).toThrow(ForbiddenException);
  });

  it('should default to the last 30 days ending today in Mogadishu', () => {
    const s = service.scope(user('ADMIN', null), {}, now);
    expect(s).toMatchObject({ from: '2026-09-16', to: '2026-10-15' });
    expect(s.start.toISOString()).toBe('2026-09-15T21:00:00.000Z');
    expect(s.end.toISOString()).toBe('2026-10-15T21:00:00.000Z');
  });
});

describe('Mogadishu days', () => {
  it('should use UTC+3 boundaries', () => {
    expect(mogadishuToday(new Date('2026-10-14T20:59:59Z'))).toBe('2026-10-14');
    expect(mogadishuToday(new Date('2026-10-14T21:00:00Z'))).toBe('2026-10-15');
    expect(dayStart('2026-10-14').toISOString()).toBe('2026-10-13T21:00:00.000Z');
    expect(dayEnd('2026-10-14').toISOString()).toBe('2026-10-14T21:00:00.000Z');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
