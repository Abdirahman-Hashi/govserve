import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { type AuditService } from '../audit/audit.service';
import { type AuthUser } from '../auth/auth.types';
import { type PaymentStatus, type Prisma, type RefundStatus } from '../generated/prisma/client';
import { type Actor, MoneyStateService } from './money-state.service';
import { type MoneyActor, PAYMENT_TRANSITIONS, REFUND_TRANSITIONS } from './payment-transitions';

const DEPT = 'dept-police';
const scope = { applicantId: 'citizen-1', departmentId: DEPT };
const citizen: AuthUser = {
  id: 'citizen-1',
  role: 'CITIZEN',
  departmentId: null,
  departmentCode: null,
  sid: 's',
};
const otherCitizen: AuthUser = { ...citizen, id: 'citizen-2' };
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
const foreign: AuthUser = { ...officer, id: 'officer-9', departmentId: 'dept-civil' };
const actorFor: Record<MoneyActor, Actor> = {
  OWNER: citizen,
  DEPT_STAFF: officer,
  SUPERVISOR: supervisor,
  SYSTEM: 'SYSTEM',
};

const PAYMENT_STATUSES: PaymentStatus[] = [
  'INITIATED',
  'PENDING_VERIFICATION',
  'AWAITING_SUPERVISOR',
  'CONFIRMED',
  'REJECTED',
  'FAILED',
  'REVERSED',
];
const REFUND_STATUSES: RefundStatus[] = [
  'REQUESTED',
  'APPROVED',
  'DECLINED',
  'COMPLETED',
  'FAILED',
];

function fakeTx(current: { status: string; version: number }) {
  const writes: string[] = [];
  const updateMany = jest.fn(({ where }: { where: { status: string; version: number } }) => {
    const ok = where.status === current.status && where.version === current.version;
    if (ok) writes.push('update');
    return Promise.resolve({ count: ok ? 1 : 0 });
  });
  const row = {
    id: 'p1',
    paymentId: 'p1',
    applicationId: 'a1',
    channel: 'MOBILE_MONEY',
    amountCents: 1500n,
    reason: 'OVERPAYMENT',
    ...current,
  };
  const tx = {
    payment: {
      updateMany,
      findUniqueOrThrow: () => Promise.resolve(row),
      create: () => (writes.push('create'), Promise.resolve(row)),
    },
    refund: {
      updateMany,
      findUniqueOrThrow: () => Promise.resolve(row),
      create: () => (writes.push('create'), Promise.resolve(row)),
    },
    paymentEvent: { create: () => (writes.push('event'), Promise.resolve({})) },
    outboxEvent: { create: () => (writes.push('outbox'), Promise.resolve({})) },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, writes };
}

const audit = { record: () => Promise.resolve() } as unknown as AuditService;
const svc = new MoneyStateService(audit);

describe('payment state machine (STATE_MACHINES §2)', () => {
  const allowed = new Set(
    PAYMENT_TRANSITIONS.filter((t) => t.from).map((t) => `${t.from}>${t.to}`),
  );
  const disallowed = PAYMENT_STATUSES.flatMap((f) =>
    PAYMENT_STATUSES.map((t) => [f, t] as const),
  ).filter(([f, t]) => !allowed.has(`${f}>${t}`));

  it.each(
    PAYMENT_TRANSITIONS.filter((t) => t.from).map(
      (t) => [t.id, t.from!, t.to, t.actors[0]!] as const,
    ),
  )('should allow %s %s → %s and write event, audit and outbox', async (_id, from, to, actor) => {
    const { tx, writes } = fakeTx({ status: from, version: 1 });
    await svc.transitionPayment(tx, { id: 'p1', status: from, version: 1 }, to, {
      actor: actorFor[actor],
      scope,
    });
    expect(writes).toEqual(['update', 'event', 'outbox']);
  });

  it.each(disallowed)('should refuse %s → %s with 409 and no writes', async (from, to) => {
    const { tx, writes } = fakeTx({ status: from, version: 1 });
    await expect(
      svc.transitionPayment(tx, { id: 'p1', status: from, version: 1 }, to, {
        actor: 'SYSTEM',
        scope,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(writes).toEqual([]);
  });

  it('should let only the gateway (system) confirm a card payment', () => {
    for (const actor of [officer, supervisor, citizen]) {
      expect(() => svc.assertPayment('INITIATED', 'CONFIRMED', actor, scope)).toThrow(
        ForbiddenException,
      );
    }
    expect(svc.assertPayment('INITIATED', 'CONFIRMED', 'SYSTEM', scope)).toBe('PAYMENT_CONFIRMED');
  });

  it('should let only a supervisor give the second confirmation or reject from AWAITING_SUPERVISOR', () => {
    expect(() => svc.assertPayment('AWAITING_SUPERVISOR', 'CONFIRMED', officer, scope)).toThrow(
      ForbiddenException,
    );
    expect(() => svc.assertPayment('AWAITING_SUPERVISOR', 'REJECTED', officer, scope)).toThrow(
      ForbiddenException,
    );
    expect(svc.assertPayment('AWAITING_SUPERVISOR', 'CONFIRMED', supervisor, scope)).toBe(
      'PAYMENT_CONFIRMED',
    );
  });

  it('should hide other citizens’ payments (404) and refuse other departments (403)', () => {
    expect(() => svc.assertPayment(null, 'PENDING_VERIFICATION', otherCitizen, scope)).toThrow(
      NotFoundException,
    );
    expect(() => svc.assertPayment('PENDING_VERIFICATION', 'CONFIRMED', foreign, scope)).toThrow(
      ForbiddenException,
    );
  });

  it('should report a lost race as 409 CONCURRENT_UPDATE without side effects', async () => {
    const { tx, writes } = fakeTx({ status: 'PENDING_VERIFICATION', version: 2 });
    await expect(
      svc.transitionPayment(
        tx,
        { id: 'p1', status: 'PENDING_VERIFICATION', version: 1 },
        'CONFIRMED',
        { actor: officer, scope },
      ),
    ).rejects.toMatchObject({ response: { code: 'CONCURRENT_UPDATE' } });
    expect(writes).toEqual([]);
  });
});

describe('refund state machine (STATE_MACHINES §3)', () => {
  const allowed = new Set(REFUND_TRANSITIONS.filter((t) => t.from).map((t) => `${t.from}>${t.to}`));
  const disallowed = REFUND_STATUSES.flatMap((f) =>
    REFUND_STATUSES.map((t) => [f, t] as const),
  ).filter(([f, t]) => !allowed.has(`${f}>${t}`));

  it.each(
    REFUND_TRANSITIONS.filter((t) => t.from).map(
      (t) => [t.id, t.from!, t.to, t.actors[0]!] as const,
    ),
  )('should allow %s %s → %s', async (_id, from, to, actor) => {
    const { tx, writes } = fakeTx({ status: from, version: 1 });
    await svc.transitionRefund(tx, { id: 'r1', paymentId: 'p1', status: from, version: 1 }, to, {
      actor: actorFor[actor],
      scope,
    });
    expect(writes).toEqual(['update', 'event', 'outbox']);
  });

  it.each(disallowed)('should refuse %s → %s with 409', async (from, to) => {
    const { tx, writes } = fakeTx({ status: from, version: 1 });
    await expect(
      svc.transitionRefund(tx, { id: 'r1', paymentId: 'p1', status: from, version: 1 }, to, {
        actor: 'SYSTEM',
        scope,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(writes).toEqual([]);
  });

  it('should not let an officer approve a refund', async () => {
    const { tx } = fakeTx({ status: 'REQUESTED', version: 1 });
    await expect(
      svc.transitionRefund(
        tx,
        { id: 'r1', paymentId: 'p1', status: 'REQUESTED', version: 1 },
        'APPROVED',
        { actor: officer, scope },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
