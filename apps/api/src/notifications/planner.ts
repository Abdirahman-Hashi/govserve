import { type EventTemplate, type NotificationVars, OptionalTemplates } from '@govserve/shared';

/** What the relay loaded for an event (IDs and non-PII facts only). */
export interface EventContext {
  type: string;
  payload: Record<string, unknown>;
  application: {
    id: string;
    referenceNo: string | null;
    kind: 'STANDARD' | 'DUPLICATE';
    applicantId: string;
    departmentId: string;
  } | null;
  /** The appointment just booked (APPOINTMENT_SCHEDULED). */
  appointment?: { scheduledAt: Date; location: string; rescheduleCount: number } | null;
  /** Deadline of the open correction round. */
  correctionDueAt?: Date | null;
}

export interface Intent {
  template: EventTemplate;
  recipients: 'APPLICANT' | 'DEPARTMENT_SUPERVISORS' | 'ADMINS';
  mandatory: boolean;
  vars: NotificationVars;
}

const intent = (
  template: EventTemplate,
  ctx: EventContext,
  extra: NotificationVars = {},
  recipients: Intent['recipients'] = 'APPLICANT',
): Intent[] => [
  {
    template,
    recipients,
    mandatory: !OptionalTemplates.includes(template),
    vars: {
      ...(ctx.application?.referenceNo && { referenceNo: ctx.application.referenceNo }),
      ...(ctx.application && { applicationId: ctx.application.id }),
      ...extra,
    },
  },
];

/**
 * FR-100: which message(s) an outbox event produces. Pure: the relay loads the context first.
 * Events without an application (or not in the list) notify nobody.
 */
export function plan(ctx: EventContext): Intent[] {
  // System-wide alert with no application: every active admin (ADR-0010).
  if (ctx.type === 'AUDIT_CHAIN_BROKEN') {
    const seq = ctx.payload['chainSeq'];
    return [
      {
        template: 'AUDIT_CHAIN_BROKEN',
        recipients: 'ADMINS',
        mandatory: true,
        vars: typeof seq === 'string' ? { chainSeq: seq } : {},
      },
    ];
  }
  if (!ctx.application) return [];
  const status = typeof ctx.payload['status'] === 'string' ? ctx.payload['status'] : null;
  switch (ctx.type) {
    case 'APPLICATION_SUBMITTED':
      return intent('APPLICATION_SUBMITTED', ctx);
    case 'PAYMENT_SUBMITTED':
      return intent('PAYMENT_RECEIVED', ctx);
    case 'PAYMENT_CASH_RECORDED':
      // P3 confirms at once (receipt); P4 (large amounts) waits for a supervisor.
      return intent(status === 'CONFIRMED' ? 'PAYMENT_CONFIRMED' : 'PAYMENT_RECEIVED', ctx);
    case 'PAYMENT_CONFIRMED':
      return intent('PAYMENT_CONFIRMED', ctx);
    case 'PAYMENT_REJECTED':
      return intent('PAYMENT_REJECTED', ctx);
    case 'APPLICATION_CORRECTION_REQUESTED':
      return intent(
        'CORRECTION_REQUESTED',
        ctx,
        ctx.correctionDueAt ? { dueAt: ctx.correctionDueAt.toISOString() } : {},
      );
    case 'CORRECTION_DEADLINE_REMINDER':
      return intent('CORRECTION_REMINDER', ctx, {
        ...(typeof ctx.payload['daysLeft'] === 'number' && {
          daysLeft: String(ctx.payload['daysLeft']),
        }),
        ...(typeof ctx.payload['dueAt'] === 'string' && { dueAt: ctx.payload['dueAt'] }),
      });
    case 'APPOINTMENT_SCHEDULED':
      if (!ctx.appointment) return [];
      return intent(
        ctx.appointment.rescheduleCount > 0 ? 'APPOINTMENT_CHANGED' : 'APPOINTMENT_SCHEDULED',
        ctx,
        {
          appointmentAt: ctx.appointment.scheduledAt.toISOString(),
          location: ctx.appointment.location,
        },
      );
    case 'APPLICATION_ISSUED':
      return intent(
        ctx.application.kind === 'DUPLICATE' ? 'COPY_ISSUED' : 'CERTIFICATE_ISSUED',
        ctx,
      );
    case 'APPLICATION_REJECTED':
      return intent('APPLICATION_REJECTED', ctx);
    case 'APPLICATION_REFERRED':
      // FR-101: the reason is never carried, not even in stored variables.
      return intent('APPLICATION_REFERRED', ctx);
    case 'APPLICATION_WITHDRAWN':
      return intent('APPLICATION_WITHDRAWN', ctx);
    case 'REFUND_COMPLETED':
      return intent('REFUND_PROCESSED', ctx);
    case 'SLA_BREACHED':
      return intent('SLA_BREACHED', ctx, {}, 'DEPARTMENT_SUPERVISORS');
    default:
      return [];
  }
}
