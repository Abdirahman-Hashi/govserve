import { type ApplicationStatus } from '../generated/prisma/client';

/**
 * Who may perform a transition (docs/STATE_MACHINES.md §1):
 * OWNER = the applicant citizen; DEPT_STAFF = officer/supervisor of the application's department;
 * ASSIGNEE = the officer/supervisor holding the claim; SUPERVISOR = supervisor of the department.
 */
export type TransitionActor = 'OWNER' | 'DEPT_STAFF' | 'ASSIGNEE' | 'SUPERVISOR' | 'SYSTEM';

export interface TransitionDef {
  id: string;
  from: ApplicationStatus;
  to: ApplicationStatus;
  actors: TransitionActor[];
  audit: string;
}

const OPEN_AFTER_SUBMIT: ApplicationStatus[] = [
  'AWAITING_PAYMENT',
  'QUEUED',
  'IN_REVIEW',
  'CORRECTION_REQUESTED',
  'AWAITING_APPOINTMENT',
  'AWAITING_SUPERVISOR',
];

/** Every allowed status change. Anything not listed is refused with 409 (A1/A2/A10 are not status changes). */
export const TRANSITIONS: TransitionDef[] = [
  {
    id: 'A3',
    from: 'DRAFT',
    to: 'AWAITING_PAYMENT',
    actors: ['OWNER'],
    audit: 'APPLICATION_SUBMITTED',
  },
  { id: 'A4', from: 'DRAFT', to: 'ABANDONED', actors: ['SYSTEM'], audit: 'APPLICATION_ABANDONED' },
  {
    id: 'A5',
    from: 'AWAITING_PAYMENT',
    to: 'QUEUED',
    actors: ['SYSTEM'],
    audit: 'APPLICATION_QUEUED',
  },
  {
    id: 'A6',
    from: 'AWAITING_PAYMENT',
    to: 'ISSUED',
    actors: ['SYSTEM'],
    audit: 'APPLICATION_ISSUED',
  },
  {
    id: 'A7',
    from: 'AWAITING_PAYMENT',
    to: 'ABANDONED',
    actors: ['SYSTEM'],
    audit: 'APPLICATION_ABANDONED',
  },
  {
    id: 'A8',
    from: 'QUEUED',
    to: 'IN_REVIEW',
    actors: ['DEPT_STAFF'],
    audit: 'APPLICATION_CLAIMED',
  },
  {
    id: 'A9',
    from: 'IN_REVIEW',
    to: 'QUEUED',
    actors: ['ASSIGNEE', 'SUPERVISOR', 'SYSTEM'],
    audit: 'APPLICATION_RELEASED',
  },
  {
    id: 'A11',
    from: 'IN_REVIEW',
    to: 'CORRECTION_REQUESTED',
    actors: ['ASSIGNEE'],
    audit: 'APPLICATION_CORRECTION_REQUESTED',
  },
  {
    id: 'A12',
    from: 'CORRECTION_REQUESTED',
    to: 'IN_REVIEW',
    actors: ['OWNER'],
    audit: 'APPLICATION_RESUBMITTED',
  },
  {
    id: 'A13',
    from: 'CORRECTION_REQUESTED',
    to: 'ABANDONED',
    actors: ['SYSTEM'],
    audit: 'APPLICATION_ABANDONED',
  },
  {
    id: 'A14',
    from: 'IN_REVIEW',
    to: 'AWAITING_APPOINTMENT',
    actors: ['ASSIGNEE'],
    audit: 'APPOINTMENT_SCHEDULED',
  },
  {
    id: 'A15',
    from: 'AWAITING_APPOINTMENT',
    to: 'IN_REVIEW',
    actors: ['ASSIGNEE', 'SUPERVISOR'],
    audit: 'APPOINTMENT_RECORDED',
  },
  {
    id: 'A16',
    from: 'IN_REVIEW',
    to: 'ISSUED',
    actors: ['ASSIGNEE'],
    audit: 'APPLICATION_APPROVED',
  },
  {
    id: 'A17',
    from: 'IN_REVIEW',
    to: 'AWAITING_SUPERVISOR',
    actors: ['ASSIGNEE'],
    audit: 'APPLICATION_FORWARDED',
  },
  {
    id: 'A18',
    from: 'AWAITING_SUPERVISOR',
    to: 'ISSUED',
    actors: ['SUPERVISOR'],
    audit: 'APPLICATION_APPROVED',
  },
  {
    id: 'A19',
    from: 'AWAITING_SUPERVISOR',
    to: 'REFERRED',
    actors: ['SUPERVISOR'],
    audit: 'APPLICATION_REFERRED',
  },
  {
    id: 'A20',
    from: 'AWAITING_SUPERVISOR',
    to: 'IN_REVIEW',
    actors: ['SUPERVISOR'],
    audit: 'APPLICATION_RETURNED',
  },
  {
    id: 'A21',
    from: 'IN_REVIEW',
    to: 'REJECTED',
    actors: ['ASSIGNEE'],
    audit: 'APPLICATION_REJECTED',
  },
  {
    id: 'A21',
    from: 'AWAITING_SUPERVISOR',
    to: 'REJECTED',
    actors: ['SUPERVISOR'],
    audit: 'APPLICATION_REJECTED',
  },
  ...OPEN_AFTER_SUBMIT.map((from): TransitionDef => ({
    id: 'A22',
    from,
    to: 'WITHDRAWN',
    actors: ['OWNER'],
    audit: 'APPLICATION_WITHDRAWN',
  })),
];

export const TERMINAL: ApplicationStatus[] = [
  'ISSUED',
  'REJECTED',
  'REFERRED',
  'WITHDRAWN',
  'ABANDONED',
];

export function findTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): TransitionDef | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}
