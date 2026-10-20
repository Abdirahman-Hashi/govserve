import { type Role } from '@govserve/shared';

/**
 * The permission matrix of docs/SPEC.md §2.1, one entry per endpoint. authz-matrix.int-spec.ts calls every
 * endpoint as every role and fails when an endpoint is missing here, so a new route cannot skip the decision.
 * docs/AUTHZ_MATRIX.md is generated from this table (authz-matrix.spec.ts keeps them in step).
 */

/** SPEC §2.1 rows, verbatim. */
export const ROW = {
  register: 'Register / verify email / reset password',
  profile: 'View/edit own profile',
  catalogue: 'Browse service catalogue',
  draft: 'Create/edit/delete draft, submit, withdraw',
  upload: 'Upload documents, respond to corrections',
  pay: 'Submit mobile-money/bank payment evidence; pay by card',
  own: 'View own applications, payments, receipts, certificates',
  duplicate: 'Order a duplicate certificate',
  queue: 'View department queue, claim, review',
  corrections: 'Request correction, schedule/complete appointment',
  approve: 'Approve (single-approval services) / reject',
  refer: 'Propose REFERRED (police) / forward for second approval',
  second: 'Second approval (birth, police referral)',
  cash: 'Record cash payment; confirm/reject manual payment ≤ threshold',
  cardConfirm: 'Confirm card payment',
  reassign: 'Reassign / release claims',
  requestRefund: 'Request a refund (duplicate, overpayment, withdrawal before review)',
  refund: 'Approve refund; resolve chargeback flag',
  revoke: 'Revoke certificate',
  search: 'Search applications/transactions',
  reports: 'Dashboard and reports; CSV export',
  audit: 'Audit log viewer (read-only)',
  auditVerify: 'Run audit-chain verification',
  staff: 'Manage staff users, departments, roles',
  config: 'Manage services, service versions, fees, settings',
  notifications: 'View own notifications; notification preferences',
  verify: 'Public certificate/receipt verification',
  auth: 'Sign in, sessions and invitations (public endpoints)',
  ops: 'Operations: health, readiness, metrics (bearer token)',
  mockGateway: 'Mock card gateway (test deployments only; refused in production)',
} as const;

/** The resource an `:id`-style parameter names; the test fills it with a record owned by citizen A in department A. */
export type Resource =
  'application' | 'document' | 'payment' | 'certificate' | 'refund' | 'notification' | 'user';

/**
 * How ownership (O) or department (D) scoping is proven for callers from outside the record's scope
 * (citizen B, officer B, supervisor B; whichever roles the endpoint allows):
 * - resource: called on A's record, the answer is 403 or 404 and nothing about the record changes;
 * - list: the answer never contains A's identifiers;
 * - report: supervisor B asking for department A gets exactly their own department's figures.
 */
export type Scope =
  { kind: 'resource'; resource: Resource } | { kind: 'list' } | { kind: 'report' };

export interface Rule {
  rows: (keyof typeof ROW)[];
  /** 'public' needs no session; 'token' is public but guarded by its own credential (bearer token, HMAC). */
  allow: 'public' | 'token' | Role[];
  scope?: Scope;
  note?: string;
}

const C: Role[] = ['CITIZEN'];
const STAFF: Role[] = ['OFFICER', 'SUPERVISOR'];
const SUP: Role[] = ['SUPERVISOR'];
const ADMIN: Role[] = ['ADMIN'];
const SUP_ADMIN: Role[] = ['SUPERVISOR', 'ADMIN'];
const ANYONE: Role[] = ['CITIZEN', 'OFFICER', 'SUPERVISOR', 'ADMIN'];

const res = (resource: Resource): Scope => ({ kind: 'resource', resource });
const LIST: Scope = { kind: 'list' };
const REPORT: Scope = { kind: 'report' };

export const MATRIX: Record<string, Rule> = {
  // Accounts and profile
  'GET /api/v1/users/me': { rows: ['profile'], allow: ANYONE },
  'PATCH /api/v1/users/me': { rows: ['profile'], allow: ANYONE },
  'POST /api/v1/users/me/email': { rows: ['profile'], allow: ANYONE },
  'POST /api/v1/users/me/email/confirm': { rows: ['profile'], allow: ANYONE },
  'GET /api/v1/users/:id': {
    rows: ['profile', 'staff'],
    allow: ['CITIZEN', 'ADMIN'],
    scope: res('user'),
    note: 'Citizens only themselves (others are 404); admins anyone.',
  },
  'GET /api/v1/account/notification-preferences': { rows: ['notifications'], allow: ANYONE },
  'PUT /api/v1/account/notification-preferences': { rows: ['notifications'], allow: ANYONE },
  'GET /api/v1/notifications': { rows: ['notifications'], allow: ANYONE, scope: LIST },
  'GET /api/v1/notifications/unread-count': { rows: ['notifications'], allow: ANYONE },
  'POST /api/v1/notifications/:id/read': {
    rows: ['notifications'],
    allow: ANYONE,
    scope: res('notification'),
  },
  'POST /api/v1/notifications/read-all': { rows: ['notifications'], allow: ANYONE },

  // Authentication (public; each endpoint checks its own code, token or cookie)
  'POST /api/v1/auth/register': { rows: ['register'], allow: 'public' },
  'POST /api/v1/auth/verify-email': { rows: ['register'], allow: 'public' },
  'POST /api/v1/auth/resend-code': { rows: ['register'], allow: 'public' },
  'POST /api/v1/auth/password/forgot': { rows: ['register'], allow: 'public' },
  'POST /api/v1/auth/password/reset': { rows: ['register'], allow: 'public' },
  'POST /api/v1/auth/login': { rows: ['auth'], allow: 'public' },
  'POST /api/v1/auth/login/otp': { rows: ['auth'], allow: 'public' },
  'POST /api/v1/auth/refresh': {
    rows: ['auth'],
    allow: 'public',
    note: '401 without a refresh cookie.',
  },
  'POST /api/v1/auth/logout': { rows: ['auth'], allow: 'public' },
  'POST /api/v1/auth/invitations/accept': { rows: ['auth'], allow: 'public' },

  // Catalogue and public verification
  'GET /api/v1/catalogue/services': { rows: ['catalogue'], allow: 'public' },
  'GET /api/v1/catalogue/services/:code': { rows: ['catalogue'], allow: 'public' },
  'GET /api/v1/verify/c/:certificateNo': { rows: ['verify'], allow: 'public' },
  'POST /api/v1/verify/c/:certificateNo/name-check': { rows: ['verify'], allow: 'public' },
  'GET /api/v1/verify/r/:receiptNo': { rows: ['verify'], allow: 'public' },
  'GET /api/v1/verify/keys': { rows: ['verify'], allow: 'public' },

  // Citizen applications, documents and payments
  'GET /api/v1/applications': { rows: ['own', 'search'], allow: C, scope: LIST },
  'POST /api/v1/applications': { rows: ['draft'], allow: C },
  'GET /api/v1/applications/:id': { rows: ['own'], allow: C, scope: res('application') },
  'PATCH /api/v1/applications/:id': { rows: ['draft'], allow: C, scope: res('application') },
  'DELETE /api/v1/applications/:id': { rows: ['draft'], allow: C, scope: res('application') },
  'POST /api/v1/applications/:id/submit': { rows: ['draft'], allow: C, scope: res('application') },
  'POST /api/v1/applications/:id/withdraw': {
    rows: ['draft'],
    allow: C,
    scope: res('application'),
  },
  'POST /api/v1/applications/:id/resubmit': {
    rows: ['upload'],
    allow: C,
    scope: res('application'),
  },
  'POST /api/v1/applications/:id/documents': {
    rows: ['upload'],
    allow: C,
    scope: res('application'),
  },
  'POST /api/v1/documents/:id/complete': { rows: ['upload'], allow: C, scope: res('document') },
  'DELETE /api/v1/documents/:id': { rows: ['upload'], allow: C, scope: res('document') },
  'GET /api/v1/documents/:id/download': { rows: ['own'], allow: C, scope: res('document') },
  'POST /api/v1/applications/:id/payments': { rows: ['pay'], allow: C, scope: res('application') },
  'POST /api/v1/applications/:id/payment-evidence': {
    rows: ['pay'],
    allow: C,
    scope: res('application'),
  },
  'POST /api/v1/applications/:id/payments/card': {
    rows: ['pay'],
    allow: C,
    scope: res('application'),
  },
  'GET /api/v1/payments': { rows: ['own', 'search'], allow: C, scope: LIST },
  'GET /api/v1/payments/:id/receipt.pdf': {
    rows: ['own', 'queue'],
    allow: ['CITIZEN', 'OFFICER', 'SUPERVISOR'],
    scope: res('payment'),
    note: 'Citizens their own; staff their department.',
  },
  'GET /api/v1/certificates': { rows: ['own'], allow: C, scope: LIST },
  'GET /api/v1/certificates/:id/certificate.pdf': {
    rows: ['own', 'queue'],
    allow: ['CITIZEN', 'OFFICER', 'SUPERVISOR'],
    scope: res('certificate'),
    note: 'Citizens their own; staff their department.',
  },
  'POST /api/v1/certificates/:id/duplicates': {
    rows: ['duplicate'],
    allow: C,
    scope: res('certificate'),
  },
  'POST /api/v1/payments/webhooks/card': {
    rows: ['cardConfirm'],
    allow: 'token',
    note: 'Gateway only: HMAC signature and timestamp.',
  },
  'GET /api/v1/mock-gateway/checkout/:ref': { rows: ['mockGateway'], allow: 'public' },
  'POST /api/v1/mock-gateway/checkout/:ref/:outcome': { rows: ['mockGateway'], allow: 'public' },

  // Review
  'GET /api/v1/review/queue': { rows: ['queue'], allow: STAFF, scope: LIST },
  'POST /api/v1/review/claim-next': { rows: ['queue'], allow: STAFF },
  'GET /api/v1/review/applications/:id': {
    rows: ['queue'],
    allow: STAFF,
    scope: res('application'),
  },
  'POST /api/v1/review/applications/:id/claim': {
    rows: ['queue'],
    allow: STAFF,
    scope: res('application'),
  },
  'POST /api/v1/review/applications/:id/release': {
    rows: ['queue', 'reassign'],
    allow: STAFF,
    scope: res('application'),
    note: 'Officers release only their own claim; supervisors any in the department.',
  },
  'POST /api/v1/review/applications/:id/unmask': {
    rows: ['queue'],
    allow: STAFF,
    scope: res('application'),
  },
  'POST /api/v1/review/applications/:id/corrections': {
    rows: ['corrections'],
    allow: STAFF,
    scope: res('application'),
  },
  'POST /api/v1/review/applications/:id/appointment': {
    rows: ['corrections'],
    allow: STAFF,
    scope: res('application'),
  },
  'POST /api/v1/review/applications/:id/appointment/outcome': {
    rows: ['corrections'],
    allow: STAFF,
    scope: res('application'),
  },
  'POST /api/v1/review/applications/:id/approve': {
    rows: ['approve', 'refer'],
    allow: STAFF,
    scope: res('application'),
    note: 'Forwards to second approval for birth certificates.',
  },
  'POST /api/v1/review/applications/:id/reject': {
    rows: ['approve'],
    allow: STAFF,
    scope: res('application'),
  },
  'POST /api/v1/review/applications/:id/refer': {
    rows: ['refer'],
    allow: STAFF,
    scope: res('application'),
  },
  'POST /api/v1/review/applications/:id/second-approve': {
    rows: ['second'],
    allow: SUP,
    scope: res('application'),
    note: 'Not the first reviewer (review.int-spec, DB trigger).',
  },
  'POST /api/v1/review/applications/:id/confirm-referral': {
    rows: ['second'],
    allow: SUP,
    scope: res('application'),
  },
  'POST /api/v1/review/applications/:id/return': {
    rows: ['second'],
    allow: SUP,
    scope: res('application'),
  },
  'POST /api/v1/review/applications/:id/assign': {
    rows: ['reassign'],
    allow: SUP,
    scope: res('application'),
  },
  'POST /api/v1/review/applications/:id/chargeback': {
    rows: ['refund'],
    allow: SUP,
    scope: res('application'),
  },
  'GET /api/v1/staff/reason-codes': { rows: ['queue'], allow: STAFF },
  'GET /api/v1/staff/documents/:id/download': {
    rows: ['queue'],
    allow: STAFF,
    scope: res('document'),
  },
  'POST /api/v1/certificates/:id/revoke': {
    rows: ['revoke'],
    allow: SUP,
    scope: res('certificate'),
  },

  // Staff payments and refunds
  'GET /api/v1/staff/applications/by-reference/:referenceNo': {
    rows: ['cash'],
    allow: STAFF,
    scope: res('application'),
  },
  'POST /api/v1/staff/payments/cash': { rows: ['cash'], allow: STAFF },
  'GET /api/v1/staff/payments': { rows: ['cash'], allow: STAFF, scope: LIST },
  'GET /api/v1/staff/payments/:id': { rows: ['cash'], allow: STAFF, scope: res('payment') },
  'POST /api/v1/staff/payments/:id/confirm': {
    rows: ['cash'],
    allow: STAFF,
    scope: res('payment'),
    note: 'Above the threshold a different supervisor confirms (payments.int-spec).',
  },
  'POST /api/v1/staff/payments/:id/reject': { rows: ['cash'], allow: STAFF, scope: res('payment') },
  'POST /api/v1/staff/payments/:id/refunds': {
    rows: ['requestRefund'],
    allow: STAFF,
    scope: res('payment'),
  },
  'GET /api/v1/staff/refunds': { rows: ['refund'], allow: SUP, scope: LIST },
  'POST /api/v1/staff/refunds/:id/approve': { rows: ['refund'], allow: SUP, scope: res('refund') },
  'POST /api/v1/staff/refunds/:id/decline': { rows: ['refund'], allow: SUP, scope: res('refund') },
  'POST /api/v1/staff/refunds/:id/complete': { rows: ['refund'], allow: SUP, scope: res('refund') },
  'POST /api/v1/staff/refunds/:id/retry': { rows: ['refund'], allow: SUP, scope: res('refund') },

  // Search
  'POST /api/v1/search/applications': { rows: ['search'], allow: STAFF, scope: LIST },
  'POST /api/v1/search/payments': { rows: ['search'], allow: STAFF, scope: LIST },
  'POST /api/v1/search/applications.csv': { rows: ['reports'], allow: SUP, scope: LIST },
  'POST /api/v1/search/payments.csv': { rows: ['reports'], allow: SUP, scope: LIST },

  // Reports
  'GET /api/v1/reports/summary': { rows: ['reports'], allow: SUP_ADMIN, scope: REPORT },
  'GET /api/v1/reports/collections': { rows: ['reports'], allow: SUP_ADMIN, scope: REPORT },
  'GET /api/v1/reports/volumes': { rows: ['reports'], allow: SUP_ADMIN, scope: REPORT },
  'GET /api/v1/reports/pending-work': { rows: ['reports'], allow: SUP_ADMIN, scope: REPORT },
  'GET /api/v1/reports/applications': { rows: ['reports'], allow: SUP_ADMIN, scope: REPORT },
  'GET /api/v1/reports/movements': { rows: ['reports'], allow: SUP_ADMIN, scope: REPORT },
  'GET /api/v1/reports/export/:dataset.csv': { rows: ['reports'], allow: SUP_ADMIN, scope: REPORT },

  // Audit
  'GET /api/v1/audit': { rows: ['audit'], allow: SUP_ADMIN, scope: LIST },
  'GET /api/v1/audit/export.csv': { rows: ['audit'], allow: SUP_ADMIN, scope: LIST },
  'GET /api/v1/audit/applications/:id': {
    rows: ['audit'],
    allow: SUP_ADMIN,
    scope: res('application'),
  },
  'POST /api/v1/audit/verify': { rows: ['auditVerify'], allow: ADMIN },

  // Administration
  'GET /api/v1/staff': { rows: ['staff'], allow: ADMIN },
  'POST /api/v1/staff/invitations': { rows: ['staff'], allow: ADMIN },
  'PATCH /api/v1/staff/:id': { rows: ['staff'], allow: ADMIN },
  'POST /api/v1/staff/:id/deactivate': { rows: ['staff'], allow: ADMIN },
  'GET /api/v1/admin/services': { rows: ['config'], allow: ADMIN },
  'POST /api/v1/admin/services': { rows: ['config'], allow: ADMIN },
  'PATCH /api/v1/admin/services/:id': { rows: ['config'], allow: ADMIN },
  'GET /api/v1/admin/services/:id/versions': { rows: ['config'], allow: ADMIN },
  'POST /api/v1/admin/services/:id/versions': { rows: ['config'], allow: ADMIN },
  'GET /api/v1/admin/versions/:id': { rows: ['config'], allow: ADMIN },
  'PATCH /api/v1/admin/versions/:id': { rows: ['config'], allow: ADMIN },
  'DELETE /api/v1/admin/versions/:id': { rows: ['config'], allow: ADMIN },
  'POST /api/v1/admin/versions/:id/publish': { rows: ['config'], allow: ADMIN },
  'POST /api/v1/admin/versions/:id/retire': { rows: ['config'], allow: ADMIN },
  'GET /api/v1/admin/settings': { rows: ['config'], allow: ADMIN },
  'PUT /api/v1/admin/settings/:key': { rows: ['config'], allow: ADMIN },
  'GET /api/v1/admin/holidays': { rows: ['config'], allow: ADMIN },
  'POST /api/v1/admin/holidays': { rows: ['config'], allow: ADMIN },
  'DELETE /api/v1/admin/holidays/:date': { rows: ['config'], allow: ADMIN },
  'GET /api/v1/admin/reason-codes': { rows: ['config'], allow: ADMIN },
  'POST /api/v1/admin/reason-codes': { rows: ['config'], allow: ADMIN },
  'PATCH /api/v1/admin/reason-codes/:id': { rows: ['config'], allow: ADMIN },

  // Operations
  'GET /health': { rows: ['ops'], allow: 'public' },
  'GET /ready': { rows: ['ops'], allow: 'public' },
  'GET /metrics': { rows: ['ops'], allow: 'token', note: 'Bearer METRICS_TOKEN.' },
};

const ROLES: Role[] = ['CITIZEN', 'OFFICER', 'SUPERVISOR', 'ADMIN'];
const SCOPE_MARK: Record<Scope['kind'], string> = { resource: 'O/D', list: 'O/D', report: 'D' };

/** docs/AUTHZ_MATRIX.md, generated from MATRIX. */
export function matrixMarkdown(): string {
  const cell = (rule: Rule, role: Role) => {
    if (rule.allow === 'public') return 'public';
    if (rule.allow === 'token') return 'token';
    if (!rule.allow.includes(role)) return '—';
    if (!rule.scope || role === 'ADMIN') return '✓';
    return role === 'CITIZEN' ? 'O' : SCOPE_MARK[rule.scope.kind].replace('O/', '');
  };
  const lines = [
    '# Authorization matrix (generated)',
    '',
    'Generated from `apps/api/test/int/authz-matrix.ts`; `authz-matrix.int-spec.ts` calls every endpoint as every',
    'role (and as a citizen and staff from outside the record’s scope) and fails when the API disagrees with this',
    'table or an endpoint is missing from it. ✓ = allowed, O = own records only, D = own department only,',
    '— = 403, public = no session, token = own credential (HMAC or bearer token). Rows refer to docs/SPEC.md §2.1.',
    '',
    `| Endpoint | ${ROLES.join(' | ')} | SPEC §2.1 row | Note |`,
    `| --- | ${ROLES.map(() => '---').join(' | ')} | --- | --- |`,
    ...Object.entries(MATRIX)
      .sort(([a], [b]) => a.split(' ')[1]!.localeCompare(b.split(' ')[1]!) || a.localeCompare(b))
      .map(
        ([op, rule]) =>
          `| \`${op}\` | ${ROLES.map((r) => cell(rule, r)).join(' | ')} | ${rule.rows.map((k) => ROW[k]).join('; ')} | ${rule.note ?? ''} |`,
      ),
  ];
  return `${lines.join('\n')}\n`;
}
