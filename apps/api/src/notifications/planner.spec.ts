import { EventTemplates } from '@govserve/shared';
import { type EventContext, plan } from './planner';

const app = {
  id: '0199e0a8-7c1b-7d2e-9f00-00000000aaaa',
  referenceNo: 'GS-2026-000042',
  kind: 'STANDARD' as const,
  applicantId: '0199e0a8-7c1b-7d2e-9f00-00000000bbbb',
  departmentId: '0199e0a8-7c1b-7d2e-9f00-00000000cccc',
};
const ctx = (type: string, over: Partial<EventContext> = {}): EventContext => ({
  type,
  payload: {},
  application: app,
  ...over,
});
const one = (c: EventContext) => {
  const out = plan(c);
  expect(out).toHaveLength(1);
  return out[0]!;
};

describe('notification planner (FR-100)', () => {
  it.each([
    ['APPLICATION_SUBMITTED', 'APPLICATION_SUBMITTED', false],
    ['PAYMENT_SUBMITTED', 'PAYMENT_RECEIVED', false],
    ['PAYMENT_CONFIRMED', 'PAYMENT_CONFIRMED', true],
    ['PAYMENT_REJECTED', 'PAYMENT_REJECTED', true],
    ['APPLICATION_REJECTED', 'APPLICATION_REJECTED', true],
    ['APPLICATION_REFERRED', 'APPLICATION_REFERRED', true],
    ['APPLICATION_WITHDRAWN', 'APPLICATION_WITHDRAWN', false],
    ['REFUND_COMPLETED', 'REFUND_PROCESSED', true],
    ['APPLICATION_ISSUED', 'CERTIFICATE_ISSUED', true],
  ])('should map %s to %s (mandatory %s)', (type, template, mandatory) => {
    expect(one(ctx(type))).toMatchObject({
      template,
      mandatory,
      recipients: 'APPLICANT',
      vars: { referenceNo: app.referenceNo, applicationId: app.id },
    });
  });

  it('should treat cash recorded as a receipt only when confirmed at once', () => {
    expect(one(ctx('PAYMENT_CASH_RECORDED', { payload: { status: 'CONFIRMED' } })).template).toBe(
      'PAYMENT_CONFIRMED',
    );
    expect(
      one(ctx('PAYMENT_CASH_RECORDED', { payload: { status: 'AWAITING_SUPERVISOR' } })).template,
    ).toBe('PAYMENT_RECEIVED');
  });

  it('should announce a copy for duplicate applications', () => {
    expect(
      one(ctx('APPLICATION_ISSUED', { application: { ...app, kind: 'DUPLICATE' } })).template,
    ).toBe('COPY_ISSUED');
  });

  it('should carry the deadline, reminder days and appointment details', () => {
    const due = new Date('2026-11-12T10:00:00Z');
    expect(one(ctx('APPLICATION_CORRECTION_REQUESTED', { correctionDueAt: due })).vars.dueAt).toBe(
      due.toISOString(),
    );
    expect(
      one(
        ctx('CORRECTION_DEADLINE_REMINDER', { payload: { daysLeft: 1, dueAt: due.toISOString() } }),
      ).vars,
    ).toMatchObject({ daysLeft: '1', dueAt: due.toISOString() });
    const appointment = { scheduledAt: due, location: 'Banadir HQ', rescheduleCount: 0 };
    expect(one(ctx('APPOINTMENT_SCHEDULED', { appointment }))).toMatchObject({
      template: 'APPOINTMENT_SCHEDULED',
      vars: { appointmentAt: due.toISOString(), location: 'Banadir HQ' },
    });
    expect(
      one(ctx('APPOINTMENT_SCHEDULED', { appointment: { ...appointment, rescheduleCount: 1 } }))
        .template,
    ).toBe('APPOINTMENT_CHANGED');
  });

  it('should send SLA breaches to the department supervisors', () => {
    expect(one(ctx('SLA_BREACHED'))).toMatchObject({
      recipients: 'DEPARTMENT_SUPERVISORS',
      mandatory: true,
    });
  });

  it('should never carry a referral reason, whatever the payload holds', () => {
    const i = one(
      ctx('APPLICATION_REFERRED', { payload: { note: 'Conviction 2015', reason: 'x' } }),
    );
    expect(JSON.stringify(i)).not.toMatch(/Conviction|reason/);
  });

  it('should notify nobody for internal events or events without an application', () => {
    expect(plan(ctx('APPLICATION_CLAIMED'))).toEqual([]);
    expect(plan(ctx('PAYMENT_FIRST_CONFIRMED'))).toEqual([]);
    expect(plan(ctx('PAYMENT_CONFIRMED', { application: null }))).toEqual([]);
  });

  it('should cover every event template', () => {
    const produced = new Set(
      [
        'APPLICATION_SUBMITTED',
        'PAYMENT_SUBMITTED',
        'PAYMENT_CONFIRMED',
        'PAYMENT_REJECTED',
        'APPLICATION_CORRECTION_REQUESTED',
        'CORRECTION_DEADLINE_REMINDER',
        'APPLICATION_ISSUED',
        'APPLICATION_REJECTED',
        'APPLICATION_REFERRED',
        'APPLICATION_WITHDRAWN',
        'REFUND_COMPLETED',
        'SLA_BREACHED',
      ].map((t) => one(ctx(t)).template),
    );
    produced.add('APPOINTMENT_SCHEDULED').add('APPOINTMENT_CHANGED').add('COPY_ISSUED');
    produced.add(
      one({ type: 'AUDIT_CHAIN_BROKEN', payload: { chainSeq: '42' }, application: null }).template,
    );
    expect([...produced].sort()).toEqual([...EventTemplates].sort());
  });
});
