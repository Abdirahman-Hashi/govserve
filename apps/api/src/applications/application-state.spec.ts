import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApplicationStatus as Statuses } from '@govserve/shared';
import { type AuditService } from '../audit/audit.service';
import { type AuthUser } from '../auth/auth.types';
import { type Application, type ApplicationStatus, type Prisma } from '../generated/prisma/client';
import { type Actor, ApplicationStateService } from './application-state.service';
import { findTransition, TERMINAL, TRANSITIONS, type TransitionActor } from './transitions';

const ALL = Object.values(Statuses) as ApplicationStatus[];
const DEPT = 'dept-police';
const owner: AuthUser = {
  id: 'citizen-1',
  role: 'CITIZEN',
  departmentId: null,
  departmentCode: null,
  sid: 's',
};
const otherCitizen: AuthUser = { ...owner, id: 'citizen-2' };
const officer: AuthUser = {
  id: 'officer-1',
  role: 'OFFICER',
  departmentId: DEPT,
  departmentCode: 'POLICE',
  sid: 's',
};
const supervisor: AuthUser = {
  id: 'super-1',
  role: 'SUPERVISOR',
  departmentId: DEPT,
  departmentCode: 'POLICE',
  sid: 's',
};
const foreignOfficer: AuthUser = { ...officer, id: 'officer-9', departmentId: 'dept-civil' };

const app = (status: ApplicationStatus, assigneeId: string | null = officer.id) => ({
  id: 'app-1',
  status,
  version: 3,
  applicantId: owner.id,
  departmentId: DEPT,
  assigneeId,
  referenceNo: 'GS-2026-000001',
});

const actorFor: Record<TransitionActor, Actor> = {
  OWNER: owner,
  DEPT_STAFF: officer,
  ASSIGNEE: officer,
  SUPERVISOR: supervisor,
  SYSTEM: 'SYSTEM',
};

/** Records every write; updateMany succeeds only when status and version match. */
function fakeTx(current: ReturnType<typeof app>) {
  const writes: string[] = [];
  const tx = {
    application: {
      updateMany: jest.fn(({ where }: { where: { status: string; version: number } }) => {
        const ok = where.status === current.status && where.version === current.version;
        if (ok) writes.push('application.update');
        return Promise.resolve({ count: ok ? 1 : 0 });
      }),
      findUniqueOrThrow: jest.fn(() => Promise.resolve(current as unknown as Application)),
    },
    applicationStatusHistory: {
      create: jest.fn(() => (writes.push('history'), Promise.resolve({}))),
    },
    outboxEvent: { create: jest.fn(() => (writes.push('outbox'), Promise.resolve({}))) },
    auditLog: { create: jest.fn(() => (writes.push('audit'), Promise.resolve({}))) },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, writes };
}

const audit = {
  record: (tx: Prisma.TransactionClient) =>
    tx.auditLog.create({ data: {} as never }).then(() => undefined),
} as unknown as AuditService;
const service = new ApplicationStateService(audit);

describe('application state machine', () => {
  const allowedPairs = new Set(TRANSITIONS.map((t) => `${t.from}>${t.to}`));
  const disallowed = ALL.flatMap((from) => ALL.map((to) => [from, to] as const)).filter(
    ([f, t]) => !allowedPairs.has(`${f}>${t}`),
  );

  it.each(TRANSITIONS.map((t) => [t.id, t.from, t.to, t] as const))(
    'should allow %s %s → %s for its actor and write history, audit and outbox',
    async (_id, from, to, def) => {
      const current = app(from);
      const { tx, writes } = fakeTx(current);
      await service.transition(tx, { application: current, to, actor: actorFor[def.actors[0]!] });
      expect(writes).toEqual(['application.update', 'history', 'audit', 'outbox']);
    },
  );

  it.each(disallowed)('should refuse %s → %s with 409 and no writes', async (from, to) => {
    const current = app(from);
    const { tx, writes } = fakeTx(current);
    await expect(
      service.transition(tx, { application: current, to, actor: 'SYSTEM' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(writes).toEqual([]);
  });

  it('should have no transitions out of terminal states', () => {
    expect(TRANSITIONS.filter((t) => TERMINAL.includes(t.from))).toEqual([]);
  });

  it('should hide another citizen application as 404', async () => {
    const { tx, writes } = fakeTx(app('AWAITING_PAYMENT'));
    await expect(
      service.transition(tx, {
        application: app('AWAITING_PAYMENT'),
        to: 'WITHDRAWN',
        actor: otherCitizen,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(writes).toEqual([]);
  });

  it('should refuse staff from another department with 403', () => {
    expect(() =>
      service.assertAllowed({ application: app('QUEUED'), to: 'IN_REVIEW', actor: foreignOfficer }),
    ).toThrow(ForbiddenException);
  });

  it('should refuse a non-assignee officer and let only supervisors confirm a referral', () => {
    const notAssigned = app('IN_REVIEW', 'someone-else');
    expect(() =>
      service.assertAllowed({ application: notAssigned, to: 'REJECTED', actor: officer }),
    ).toThrow(ForbiddenException);
    expect(() =>
      service.assertAllowed({
        application: app('AWAITING_SUPERVISOR'),
        to: 'REFERRED',
        actor: officer,
      }),
    ).toThrow(ForbiddenException);
    expect(
      service.assertAllowed({
        application: app('AWAITING_SUPERVISOR'),
        to: 'REFERRED',
        actor: supervisor,
      }).id,
    ).toBe('A19');
  });

  it('should refuse a citizen performing a system transition', () => {
    expect(() =>
      service.assertAllowed({ application: app('AWAITING_PAYMENT'), to: 'QUEUED', actor: owner }),
    ).toThrow(ForbiddenException);
  });

  it('should report a concurrent update as 409 without side effects', async () => {
    const current = app('DRAFT');
    const { tx, writes } = fakeTx(current);
    await expect(
      service.transition(tx, {
        application: { ...current, version: 2 },
        to: 'AWAITING_PAYMENT',
        actor: owner,
      }),
    ).rejects.toMatchObject({ response: { code: 'CONCURRENT_UPDATE' } });
    expect(writes).toEqual([]);
  });

  it('should define each from/to pair once', () => {
    expect(allowedPairs.size).toBe(TRANSITIONS.length);
    expect(findTransition('DRAFT', 'AWAITING_PAYMENT')?.id).toBe('A3');
  });
});
