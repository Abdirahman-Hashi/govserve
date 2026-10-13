import { type PaymentStatus, type RefundStatus } from '../generated/prisma/client';

/** DEPT_STAFF = officer/supervisor of the application's department; SUPERVISOR = supervisor of it. */
export type MoneyActor = 'OWNER' | 'DEPT_STAFF' | 'SUPERVISOR' | 'SYSTEM';

export interface PaymentTransition {
  id: string;
  from: PaymentStatus | null;
  to: PaymentStatus;
  actors: MoneyActor[];
  audit: string;
}

/** docs/STATE_MACHINES.md §2. Card payments move only by the signed webhook (SYSTEM). */
export const PAYMENT_TRANSITIONS: PaymentTransition[] = [
  {
    id: 'P1',
    from: null,
    to: 'PENDING_VERIFICATION',
    actors: ['OWNER'],
    audit: 'PAYMENT_SUBMITTED',
  },
  { id: 'P2', from: null, to: 'INITIATED', actors: ['OWNER'], audit: 'PAYMENT_INITIATED' },
  { id: 'P3', from: null, to: 'CONFIRMED', actors: ['DEPT_STAFF'], audit: 'PAYMENT_CASH_RECORDED' },
  {
    id: 'P4',
    from: null,
    to: 'AWAITING_SUPERVISOR',
    actors: ['DEPT_STAFF'],
    audit: 'PAYMENT_CASH_RECORDED',
  },
  {
    id: 'P5',
    from: 'PENDING_VERIFICATION',
    to: 'CONFIRMED',
    actors: ['DEPT_STAFF'],
    audit: 'PAYMENT_CONFIRMED',
  },
  {
    id: 'P6',
    from: 'PENDING_VERIFICATION',
    to: 'AWAITING_SUPERVISOR',
    actors: ['DEPT_STAFF'],
    audit: 'PAYMENT_FIRST_CONFIRMED',
  },
  {
    id: 'P7',
    from: 'PENDING_VERIFICATION',
    to: 'REJECTED',
    actors: ['DEPT_STAFF'],
    audit: 'PAYMENT_REJECTED',
  },
  {
    id: 'P7',
    from: 'AWAITING_SUPERVISOR',
    to: 'REJECTED',
    actors: ['SUPERVISOR'],
    audit: 'PAYMENT_REJECTED',
  },
  {
    id: 'P8',
    from: 'AWAITING_SUPERVISOR',
    to: 'CONFIRMED',
    actors: ['SUPERVISOR'],
    audit: 'PAYMENT_CONFIRMED',
  },
  { id: 'P9', from: 'CONFIRMED', to: 'REVERSED', actors: ['SYSTEM'], audit: 'PAYMENT_REVERSED' },
  { id: 'P10', from: 'INITIATED', to: 'CONFIRMED', actors: ['SYSTEM'], audit: 'PAYMENT_CONFIRMED' },
  { id: 'P11', from: 'INITIATED', to: 'FAILED', actors: ['SYSTEM'], audit: 'PAYMENT_FAILED' },
];

export interface RefundTransition {
  id: string;
  from: RefundStatus | null;
  to: RefundStatus;
  actors: MoneyActor[];
  audit: string;
}

/** docs/STATE_MACHINES.md §3. */
export const REFUND_TRANSITIONS: RefundTransition[] = [
  {
    id: 'R1',
    from: null,
    to: 'REQUESTED',
    actors: ['SYSTEM', 'DEPT_STAFF'],
    audit: 'REFUND_REQUESTED',
  },
  { id: 'R2', from: 'REQUESTED', to: 'APPROVED', actors: ['SUPERVISOR'], audit: 'REFUND_APPROVED' },
  { id: 'R3', from: 'REQUESTED', to: 'DECLINED', actors: ['SUPERVISOR'], audit: 'REFUND_DECLINED' },
  {
    id: 'R4',
    from: 'APPROVED',
    to: 'COMPLETED',
    actors: ['SUPERVISOR', 'SYSTEM'],
    audit: 'REFUND_COMPLETED',
  },
  { id: 'R5', from: 'APPROVED', to: 'FAILED', actors: ['SYSTEM'], audit: 'REFUND_FAILED' },
  { id: 'R6', from: 'FAILED', to: 'APPROVED', actors: ['SUPERVISOR'], audit: 'REFUND_RETRIED' },
];
