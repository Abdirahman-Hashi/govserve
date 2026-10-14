# Audit coverage (FR-130)

Every state change, payment event and admin action writes an `AuditLog` row through `AuditService.record(tx, …)` with the caller's
transaction client, so it commits or rolls back with the change. Rows are hash-chained by the database (ADR-0010).

This table is checked automatically:
- `src/audit/audit-coverage.spec.ts` fails if an action in the code is missing here, or one listed here no longer exists.
- The integration run records every action actually written (`test/int/global-teardown.ts`) and fails if any listed action
  was never observed, so each row below is exercised by at least one integration test.

Not audited, by design: notification delivery bookkeeping (the notification row is its own log), outbox dispatch markers,
autosaves of a citizen's own draft, read-only views other than PII unmask and document or certificate downloads.
The e2e staff fixture (`src/cli/e2e-staff.ts`, refused when `DEPLOY_ENV=production`) writes `E2E_STAFF_PASSWORD_RESET`
for its own resets; it is a test tool, so it is not listed.

**91 actions, 100% covered.**


## Accounts & auth

| Action | Trigger | Written in (same transaction) |
| --- | --- | --- |
| `USER_REGISTERED` | Citizen registers (FR-001) | `auth/auth.service.ts` |
| `USER_EMAIL_VERIFIED` | Citizen confirms the email code | `auth/auth.service.ts` |
| `USER_CREATED` | Staff member accepts an invitation | `auth/auth.service.ts` |
| `AUTH_LOGIN` | Successful sign-in | `auth/auth.service.ts` |
| `AUTH_LOGIN_FAILED` | Wrong password or code | `auth/auth.service.ts` |
| `AUTH_LOCKED` | Account locked after repeated failures | `auth/auth.service.ts` |
| `AUTH_LOGOUT` | Sign-out (session revoked) | `auth/auth.service.ts` |
| `AUTH_REFRESH_REUSE` | Reused refresh token: whole family revoked | `auth/auth.service.ts` |
| `DEVICE_TRUSTED` | Staff device confirmed with an email code | `auth/auth.service.ts` |
| `PASSWORD_RESET` | Password reset with a code | `auth/auth.service.ts` |
| `USER_PROFILE_UPDATED` | Citizen changes profile details (field names only) | `users/users.service.ts` |
| `USER_EMAIL_CHANGED` | Email address change confirmed | `users/users.service.ts` |
| `USER_NOTIFICATION_PREFERENCES_UPDATED` | Optional-email preference changed | `notifications/notifications.service.ts` |

## Staff administration

| Action | Trigger | Written in (same transaction) |
| --- | --- | --- |
| `USER_INVITED` | Admin invites a staff member | `users/staff.service.ts` |
| `USER_ROLE_CHANGED` | Admin changes role or department | `users/staff.service.ts` |
| `USER_DEACTIVATED` | Admin deactivates a staff member | `users/staff.service.ts` |

## Catalogue & configuration

| Action | Trigger | Written in (same transaction) |
| --- | --- | --- |
| `SERVICE_CREATED` | Admin (or seed) creates a service | `catalogue/catalogue.service.ts`, `catalogue/seed.ts` |
| `SERVICE_UPDATED` | Admin edits a service | `catalogue/catalogue.service.ts` |
| `SERVICE_VERSION_CREATED` | New draft version | `catalogue/catalogue.service.ts` |
| `SERVICE_VERSION_UPDATED` | Draft version edited | `catalogue/catalogue.service.ts` |
| `SERVICE_VERSION_DELETED` | Draft version deleted | `catalogue/catalogue.service.ts` |
| `SERVICE_VERSION_PUBLISHED` | Version published (previous one retired) | `catalogue/catalogue.service.ts` |
| `SERVICE_VERSION_RETIRED` | Version retired | `catalogue/catalogue.service.ts` |
| `SETTING_UPDATED` | Admin changes a setting | `config-admin/config-admin.service.ts` |
| `SETTING_DEFAULTED` | Seed creates a missing default setting | `catalogue/seed.ts` |
| `HOLIDAY_ADDED` | Admin adds a holiday | `config-admin/config-admin.service.ts` |
| `HOLIDAY_REMOVED` | Admin removes a holiday | `config-admin/config-admin.service.ts` |
| `REASON_CODE_CREATED` | Admin (or seed) adds a reason code | `config-admin/config-admin.service.ts`, `catalogue/seed.ts` |
| `REASON_CODE_UPDATED` | Admin edits or retires a reason code | `config-admin/config-admin.service.ts` |

## Applications

| Action | Trigger | Written in (same transaction) |
| --- | --- | --- |
| `APPLICATION_CREATED` | Draft started (or a duplicate ordered) | `applications/applications.service.ts`, `certificates/certificates.service.ts` |
| `APPLICATION_DRAFT_DELETED` | Citizen deletes a draft (A2) | `applications/applications.service.ts` |
| `APPLICATION_SUBMITTED` | A3 submit (fee assessed) | `applications/transitions.ts` |
| `APPLICATION_ABANDONED` | A4 idle draft, A7 unpaid, A13 corrections overdue | `applications/transitions.ts` |
| `APPLICATION_QUEUED` | A5 paid in full | `applications/transitions.ts` |
| `APPLICATION_ISSUED` | A6 duplicate copy issued on payment | `applications/transitions.ts` |
| `APPLICATION_CLAIMED` | A8 claim | `applications/transitions.ts` |
| `APPLICATION_RELEASED` | A9 release or claim expiry | `applications/transitions.ts` |
| `APPLICATION_REASSIGNED` | A10 supervisor reassigns | `review/review.service.ts` |
| `APPLICATION_UNASSIGNED` | Assignee deactivated: waiting work unassigned | `review/review.service.ts` |
| `APPLICATION_CORRECTION_REQUESTED` | A11 corrections requested | `applications/transitions.ts` |
| `APPLICATION_RESUBMITTED` | A12 corrections resubmitted | `applications/transitions.ts` |
| `APPOINTMENT_SCHEDULED` | A14 appointment booked | `applications/transitions.ts` |
| `APPOINTMENT_RECORDED` | A15 attendance recorded | `applications/transitions.ts` |
| `APPLICATION_APPROVED` | A16 approval / A18 second approval | `applications/transitions.ts` |
| `APPLICATION_FORWARDED` | A17 forwarded to a supervisor | `applications/transitions.ts` |
| `APPLICATION_REFERRED` | A19 referral confirmed (no reason recorded) | `applications/transitions.ts` |
| `APPLICATION_RETURNED` | A20 returned to the officer | `applications/transitions.ts` |
| `APPLICATION_REJECTED` | A21 rejection with reason code | `applications/transitions.ts` |
| `APPLICATION_WITHDRAWN` | A22 withdrawal | `applications/transitions.ts` |
| `APPLICATION_PII_VIEWED` | Staff unmask personal fields | `review/review.service.ts` |
| `APPLICATION_SLA_BREACHED` | SLA missed (once per application) | `review/review.service.ts` |
| `APPLICATION_CHARGEBACK_FLAGGED` | Card chargeback flags the application | `payments/payments.service.ts` |
| `APPLICATION_CHARGEBACK_RESOLVED` | Supervisor keeps or revokes after a chargeback | `review/review.service.ts` |

## Documents

| Action | Trigger | Written in (same transaction) |
| --- | --- | --- |
| `DOCUMENT_UPLOAD_REQUESTED` | Pre-signed upload issued | `documents/documents.service.ts` |
| `DOCUMENT_UPLOADED` | Upload verified (size, type, checksum) | `documents/documents.service.ts` |
| `DOCUMENT_CLEAN` | Virus scan passed | `documents/documents.service.ts` |
| `DOCUMENT_INFECTED` | Virus scan failed (object deleted) | `documents/documents.service.ts` |
| `DOCUMENT_REJECTED` | Upload failed verification | `documents/documents.service.ts` |
| `DOCUMENT_REMOVED` | Citizen removes an upload | `documents/documents.service.ts` |
| `DOCUMENT_VIEWED` | Staff open a document | `documents/documents.service.ts` |

## Payments & refunds

| Action | Trigger | Written in (same transaction) |
| --- | --- | --- |
| `PAYMENT_SUBMITTED` | P1 mobile money / bank evidence reported | `payments/payment-transitions.ts` |
| `PAYMENT_INITIATED` | P2 card checkout started | `payments/payment-transitions.ts` |
| `PAYMENT_CASH_RECORDED` | P3/P4 cash recorded | `payments/payment-transitions.ts` |
| `PAYMENT_CONFIRMED` | P5/P8/P10 confirmed | `payments/payment-transitions.ts` |
| `PAYMENT_FIRST_CONFIRMED` | P6 first of two confirmations (> threshold) | `payments/payment-transitions.ts` |
| `PAYMENT_REJECTED` | P7 rejected with reason | `payments/payment-transitions.ts` |
| `PAYMENT_REVERSED` | P9 card chargeback | `payments/payment-transitions.ts` |
| `PAYMENT_FAILED` | P11 card payment failed | `payments/payment-transitions.ts` |
| `PAYMENT_SETTLED` | Receipt number, overpayment and running total recorded | `payments/payments.service.ts` |
| `DUPLICATE_SOURCE_NOT_VALID` | Copy paid but original no longer valid (held for refund) | `payments/payments.service.ts` |
| `REFUND_REQUESTED` | R1 refund requested | `payments/payment-transitions.ts` |
| `REFUND_APPROVED` | R2 supervisor approves | `payments/payment-transitions.ts` |
| `REFUND_DECLINED` | R3 supervisor declines | `payments/payment-transitions.ts` |
| `REFUND_COMPLETED` | R4 paid out | `payments/payment-transitions.ts` |
| `REFUND_FAILED` | R5 gateway refund failed | `payments/payment-transitions.ts` |
| `REFUND_RETRIED` | R6 retried | `payments/payment-transitions.ts` |
| `REFUND_SENT_TO_GATEWAY` | Card refund submitted to the gateway | `payments/refunds.service.ts` |

## Certificates

| Action | Trigger | Written in (same transaction) |
| --- | --- | --- |
| `CERTIFICATE_ISSUED` | C1 issued (or a copy) | `certificates/certificates.service.ts` |
| `CERTIFICATE_SUPERSEDED` | C3 replaced by a newer certificate | `certificates/certificates.service.ts` |
| `CERTIFICATE_REVOKED` | C2 revoked (and each copy) | `certificates/certificates.service.ts` |
| `CERTIFICATE_DOWNLOADED` | PDF downloaded | `certificates/certificates.service.ts` |
| `CERTIFICATE_NAME_CHECKED` | Public name check (match result only) | `certificates/certificates.service.ts` |
| `SIGNING_KEY_REGISTERED` | New signing key loaded at boot | `receipts/signing.service.ts` |
| `SIGNING_KEY_ACTIVATED` | Signing key made active | `receipts/signing.service.ts` |
| `SIGNING_KEY_RETIRED` | Signing key retired | `receipts/signing.service.ts` |

## Exports & oversight

| Action | Trigger | Written in (same transaction) |
| --- | --- | --- |
| `SEARCH_EXPORTED` | Supervisor exports search results | `search/search.service.ts` |
| `REPORT_EXPORTED` | Dashboard report exported | `reports/reports.service.ts` |
| `AUDIT_EXPORTED` | Audit trail exported | `audit/audit-query.service.ts` |

## Retention

| Action | Trigger | Written in (same transaction) |
| --- | --- | --- |
| `USER_PURGED` | Unverified account deleted after 7 days | `jobs/purge.service.ts` |
| `DOCUMENTS_PURGED` | Upload files deleted (rows kept): idle drafts, closed after 90 days, decided after 7 years | `applications/applications.service.ts`, `jobs/retention.service.ts` |
| `RETENTION_PRUNED` | Expired codes, refresh tokens and dispatched outbox rows pruned (counts) | `jobs/purge.service.ts`, `jobs/retention.service.ts` |
