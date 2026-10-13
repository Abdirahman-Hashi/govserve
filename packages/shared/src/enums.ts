// Status enums from docs/STATE_MACHINES.md. Prisma enums must use the same values.

export const ApplicationStatus = {
  DRAFT: 'DRAFT',
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  QUEUED: 'QUEUED',
  IN_REVIEW: 'IN_REVIEW',
  CORRECTION_REQUESTED: 'CORRECTION_REQUESTED',
  AWAITING_APPOINTMENT: 'AWAITING_APPOINTMENT',
  AWAITING_SUPERVISOR: 'AWAITING_SUPERVISOR',
  ISSUED: 'ISSUED',
  REJECTED: 'REJECTED',
  REFERRED: 'REFERRED',
  WITHDRAWN: 'WITHDRAWN',
  ABANDONED: 'ABANDONED',
} as const;
export type ApplicationStatus = (typeof ApplicationStatus)[keyof typeof ApplicationStatus];

export const TERMINAL_APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  'ISSUED',
  'REJECTED',
  'REFERRED',
  'WITHDRAWN',
  'ABANDONED',
];

export const PaymentStatus = {
  INITIATED: 'INITIATED',
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  AWAITING_SUPERVISOR: 'AWAITING_SUPERVISOR',
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
  REVERSED: 'REVERSED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const RefundStatus = {
  REQUESTED: 'REQUESTED',
  APPROVED: 'APPROVED',
  DECLINED: 'DECLINED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];

/** Stored certificate status; EXPIRED is derived from expiresAt at read time. */
export const CertificateStatus = {
  VALID: 'VALID',
  REVOKED: 'REVOKED',
} as const;
export type CertificateStatus = (typeof CertificateStatus)[keyof typeof CertificateStatus];

export const Role = {
  CITIZEN: 'CITIZEN',
  OFFICER: 'OFFICER',
  SUPERVISOR: 'SUPERVISOR',
  ADMIN: 'ADMIN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
