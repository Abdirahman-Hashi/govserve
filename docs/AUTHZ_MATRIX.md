# Authorization matrix (generated)

Generated from `apps/api/test/int/authz-matrix.ts`; `authz-matrix.int-spec.ts` calls every endpoint as every
role (and as a citizen and staff from outside the record’s scope) and fails when the API disagrees with this
table or an endpoint is missing from it. ✓ = allowed, O = own records only, D = own department only,
— = 403, public = no session, token = own credential (HMAC or bearer token). Rows refer to docs/SPEC.md §2.1.

| Endpoint | CITIZEN | OFFICER | SUPERVISOR | ADMIN | SPEC §2.1 row | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `GET /api/v1/account/notification-preferences` | ✓ | ✓ | ✓ | ✓ | View own notifications; notification preferences |  |
| `PUT /api/v1/account/notification-preferences` | ✓ | ✓ | ✓ | ✓ | View own notifications; notification preferences |  |
| `GET /api/v1/admin/holidays` | — | — | — | ✓ | Manage services, service versions, fees, settings |  |
| `POST /api/v1/admin/holidays` | — | — | — | ✓ | Manage services, service versions, fees, settings |  |
| `DELETE /api/v1/admin/holidays/:date` | — | — | — | ✓ | Manage services, service versions, fees, settings |  |
| `GET /api/v1/admin/reason-codes` | — | — | — | ✓ | Manage services, service versions, fees, settings |  |
| `POST /api/v1/admin/reason-codes` | — | — | — | ✓ | Manage services, service versions, fees, settings |  |
| `PATCH /api/v1/admin/reason-codes/:id` | — | — | — | ✓ | Manage services, service versions, fees, settings |  |
| `GET /api/v1/admin/services` | — | — | — | ✓ | Manage services, service versions, fees, settings |  |
| `POST /api/v1/admin/services` | — | — | — | ✓ | Manage services, service versions, fees, settings |  |
| `PATCH /api/v1/admin/services/:id` | — | — | — | ✓ | Manage services, service versions, fees, settings |  |
| `GET /api/v1/admin/services/:id/versions` | — | — | — | ✓ | Manage services, service versions, fees, settings |  |
| `POST /api/v1/admin/services/:id/versions` | — | — | — | ✓ | Manage services, service versions, fees, settings |  |
| `GET /api/v1/admin/settings` | — | — | — | ✓ | Manage services, service versions, fees, settings |  |
| `PUT /api/v1/admin/settings/:key` | — | — | — | ✓ | Manage services, service versions, fees, settings |  |
| `DELETE /api/v1/admin/versions/:id` | — | — | — | ✓ | Manage services, service versions, fees, settings |  |
| `GET /api/v1/admin/versions/:id` | — | — | — | ✓ | Manage services, service versions, fees, settings |  |
| `PATCH /api/v1/admin/versions/:id` | — | — | — | ✓ | Manage services, service versions, fees, settings |  |
| `POST /api/v1/admin/versions/:id/publish` | — | — | — | ✓ | Manage services, service versions, fees, settings |  |
| `POST /api/v1/admin/versions/:id/retire` | — | — | — | ✓ | Manage services, service versions, fees, settings |  |
| `GET /api/v1/applications` | O | — | — | — | View own applications, payments, receipts, certificates; Search applications/transactions |  |
| `POST /api/v1/applications` | ✓ | — | — | — | Create/edit/delete draft, submit, withdraw |  |
| `DELETE /api/v1/applications/:id` | O | — | — | — | Create/edit/delete draft, submit, withdraw |  |
| `GET /api/v1/applications/:id` | O | — | — | — | View own applications, payments, receipts, certificates |  |
| `PATCH /api/v1/applications/:id` | O | — | — | — | Create/edit/delete draft, submit, withdraw |  |
| `POST /api/v1/applications/:id/documents` | O | — | — | — | Upload documents, respond to corrections |  |
| `POST /api/v1/applications/:id/payment-evidence` | O | — | — | — | Submit mobile-money/bank payment evidence; pay by card |  |
| `POST /api/v1/applications/:id/payments` | O | — | — | — | Submit mobile-money/bank payment evidence; pay by card |  |
| `POST /api/v1/applications/:id/payments/card` | O | — | — | — | Submit mobile-money/bank payment evidence; pay by card |  |
| `POST /api/v1/applications/:id/resubmit` | O | — | — | — | Upload documents, respond to corrections |  |
| `POST /api/v1/applications/:id/submit` | O | — | — | — | Create/edit/delete draft, submit, withdraw |  |
| `POST /api/v1/applications/:id/withdraw` | O | — | — | — | Create/edit/delete draft, submit, withdraw |  |
| `GET /api/v1/audit` | — | — | D | ✓ | Audit log viewer (read-only) |  |
| `GET /api/v1/audit/applications/:id` | — | — | D | ✓ | Audit log viewer (read-only) |  |
| `GET /api/v1/audit/export.csv` | — | — | D | ✓ | Audit log viewer (read-only) |  |
| `POST /api/v1/audit/verify` | — | — | — | ✓ | Run audit-chain verification |  |
| `POST /api/v1/auth/invitations/accept` | public | public | public | public | Sign in, sessions and invitations (public endpoints) |  |
| `POST /api/v1/auth/login` | public | public | public | public | Sign in, sessions and invitations (public endpoints) |  |
| `POST /api/v1/auth/login/otp` | public | public | public | public | Sign in, sessions and invitations (public endpoints) |  |
| `POST /api/v1/auth/logout` | public | public | public | public | Sign in, sessions and invitations (public endpoints) |  |
| `POST /api/v1/auth/password/forgot` | public | public | public | public | Register / verify email / reset password |  |
| `POST /api/v1/auth/password/reset` | public | public | public | public | Register / verify email / reset password |  |
| `POST /api/v1/auth/refresh` | public | public | public | public | Sign in, sessions and invitations (public endpoints) | 401 without a refresh cookie. |
| `POST /api/v1/auth/register` | public | public | public | public | Register / verify email / reset password |  |
| `POST /api/v1/auth/resend-code` | public | public | public | public | Register / verify email / reset password |  |
| `POST /api/v1/auth/verify-email` | public | public | public | public | Register / verify email / reset password |  |
| `GET /api/v1/catalogue/services` | public | public | public | public | Browse service catalogue |  |
| `GET /api/v1/catalogue/services/:code` | public | public | public | public | Browse service catalogue |  |
| `GET /api/v1/certificates` | O | — | — | — | View own applications, payments, receipts, certificates |  |
| `GET /api/v1/certificates/:id/certificate.pdf` | O | D | D | — | View own applications, payments, receipts, certificates; View department queue, claim, review | Citizens their own; staff their department. |
| `POST /api/v1/certificates/:id/duplicates` | O | — | — | — | Order a duplicate certificate |  |
| `POST /api/v1/certificates/:id/revoke` | — | — | D | — | Revoke certificate |  |
| `DELETE /api/v1/documents/:id` | O | — | — | — | Upload documents, respond to corrections |  |
| `POST /api/v1/documents/:id/complete` | O | — | — | — | Upload documents, respond to corrections |  |
| `GET /api/v1/documents/:id/download` | O | — | — | — | View own applications, payments, receipts, certificates |  |
| `GET /api/v1/mock-gateway/checkout/:ref` | public | public | public | public | Mock card gateway (test deployments only; refused in production) |  |
| `POST /api/v1/mock-gateway/checkout/:ref/:outcome` | public | public | public | public | Mock card gateway (test deployments only; refused in production) |  |
| `GET /api/v1/notifications` | O | D | D | ✓ | View own notifications; notification preferences |  |
| `POST /api/v1/notifications/:id/read` | O | D | D | ✓ | View own notifications; notification preferences |  |
| `POST /api/v1/notifications/read-all` | ✓ | ✓ | ✓ | ✓ | View own notifications; notification preferences |  |
| `GET /api/v1/notifications/unread-count` | ✓ | ✓ | ✓ | ✓ | View own notifications; notification preferences |  |
| `GET /api/v1/payments` | O | — | — | — | View own applications, payments, receipts, certificates; Search applications/transactions |  |
| `GET /api/v1/payments/:id/receipt.pdf` | O | D | D | — | View own applications, payments, receipts, certificates; View department queue, claim, review | Citizens their own; staff their department. |
| `POST /api/v1/payments/webhooks/card` | token | token | token | token | Confirm card payment | Gateway only: HMAC signature and timestamp. |
| `GET /api/v1/reports/applications` | — | — | D | ✓ | Dashboard and reports; CSV export |  |
| `GET /api/v1/reports/collections` | — | — | D | ✓ | Dashboard and reports; CSV export |  |
| `GET /api/v1/reports/export/:dataset.csv` | — | — | D | ✓ | Dashboard and reports; CSV export |  |
| `GET /api/v1/reports/movements` | — | — | D | ✓ | Dashboard and reports; CSV export |  |
| `GET /api/v1/reports/pending-work` | — | — | D | ✓ | Dashboard and reports; CSV export |  |
| `GET /api/v1/reports/summary` | — | — | D | ✓ | Dashboard and reports; CSV export |  |
| `GET /api/v1/reports/volumes` | — | — | D | ✓ | Dashboard and reports; CSV export |  |
| `GET /api/v1/review/applications/:id` | — | D | D | — | View department queue, claim, review |  |
| `POST /api/v1/review/applications/:id/appointment` | — | D | D | — | Request correction, schedule/complete appointment |  |
| `POST /api/v1/review/applications/:id/appointment/outcome` | — | D | D | — | Request correction, schedule/complete appointment |  |
| `POST /api/v1/review/applications/:id/approve` | — | D | D | — | Approve (single-approval services) / reject; Propose REFERRED (police) / forward for second approval | Forwards to second approval for birth certificates. |
| `POST /api/v1/review/applications/:id/assign` | — | — | D | — | Reassign / release claims |  |
| `POST /api/v1/review/applications/:id/chargeback` | — | — | D | — | Approve refund; resolve chargeback flag |  |
| `POST /api/v1/review/applications/:id/claim` | — | D | D | — | View department queue, claim, review |  |
| `POST /api/v1/review/applications/:id/confirm-referral` | — | — | D | — | Second approval (birth, police referral) |  |
| `POST /api/v1/review/applications/:id/corrections` | — | D | D | — | Request correction, schedule/complete appointment |  |
| `POST /api/v1/review/applications/:id/refer` | — | D | D | — | Propose REFERRED (police) / forward for second approval |  |
| `POST /api/v1/review/applications/:id/reject` | — | D | D | — | Approve (single-approval services) / reject |  |
| `POST /api/v1/review/applications/:id/release` | — | D | D | — | View department queue, claim, review; Reassign / release claims | Officers release only their own claim; supervisors any in the department. |
| `POST /api/v1/review/applications/:id/return` | — | — | D | — | Second approval (birth, police referral) |  |
| `POST /api/v1/review/applications/:id/second-approve` | — | — | D | — | Second approval (birth, police referral) | Not the first reviewer (review.int-spec, DB trigger). |
| `POST /api/v1/review/applications/:id/unmask` | — | D | D | — | View department queue, claim, review |  |
| `POST /api/v1/review/claim-next` | — | ✓ | ✓ | — | View department queue, claim, review |  |
| `GET /api/v1/review/queue` | — | D | D | — | View department queue, claim, review |  |
| `POST /api/v1/search/applications` | — | D | D | — | Search applications/transactions |  |
| `POST /api/v1/search/applications.csv` | — | — | D | — | Dashboard and reports; CSV export |  |
| `POST /api/v1/search/payments` | — | D | D | — | Search applications/transactions |  |
| `POST /api/v1/search/payments.csv` | — | — | D | — | Dashboard and reports; CSV export |  |
| `GET /api/v1/staff` | — | — | — | ✓ | Manage staff users, departments, roles |  |
| `PATCH /api/v1/staff/:id` | — | — | — | ✓ | Manage staff users, departments, roles |  |
| `POST /api/v1/staff/:id/deactivate` | — | — | — | ✓ | Manage staff users, departments, roles |  |
| `GET /api/v1/staff/applications/by-reference/:referenceNo` | — | D | D | — | Record cash payment; confirm/reject manual payment ≤ threshold |  |
| `GET /api/v1/staff/documents/:id/download` | — | D | D | — | View department queue, claim, review |  |
| `POST /api/v1/staff/invitations` | — | — | — | ✓ | Manage staff users, departments, roles |  |
| `GET /api/v1/staff/payments` | — | D | D | — | Record cash payment; confirm/reject manual payment ≤ threshold |  |
| `GET /api/v1/staff/payments/:id` | — | D | D | — | Record cash payment; confirm/reject manual payment ≤ threshold |  |
| `POST /api/v1/staff/payments/:id/confirm` | — | D | D | — | Record cash payment; confirm/reject manual payment ≤ threshold | Above the threshold a different supervisor confirms (payments.int-spec). |
| `POST /api/v1/staff/payments/:id/refunds` | — | D | D | — | Request a refund (duplicate, overpayment, withdrawal before review) |  |
| `POST /api/v1/staff/payments/:id/reject` | — | D | D | — | Record cash payment; confirm/reject manual payment ≤ threshold |  |
| `POST /api/v1/staff/payments/cash` | — | ✓ | ✓ | — | Record cash payment; confirm/reject manual payment ≤ threshold |  |
| `GET /api/v1/staff/reason-codes` | — | ✓ | ✓ | — | View department queue, claim, review |  |
| `GET /api/v1/staff/refunds` | — | — | D | — | Approve refund; resolve chargeback flag |  |
| `POST /api/v1/staff/refunds/:id/approve` | — | — | D | — | Approve refund; resolve chargeback flag |  |
| `POST /api/v1/staff/refunds/:id/complete` | — | — | D | — | Approve refund; resolve chargeback flag |  |
| `POST /api/v1/staff/refunds/:id/decline` | — | — | D | — | Approve refund; resolve chargeback flag |  |
| `POST /api/v1/staff/refunds/:id/retry` | — | — | D | — | Approve refund; resolve chargeback flag |  |
| `GET /api/v1/users/:id` | O | — | — | ✓ | View/edit own profile; Manage staff users, departments, roles | Citizens only themselves (others are 404); admins anyone. |
| `GET /api/v1/users/me` | ✓ | ✓ | ✓ | ✓ | View/edit own profile |  |
| `PATCH /api/v1/users/me` | ✓ | ✓ | ✓ | ✓ | View/edit own profile |  |
| `POST /api/v1/users/me/email` | ✓ | ✓ | ✓ | ✓ | View/edit own profile |  |
| `POST /api/v1/users/me/email/confirm` | ✓ | ✓ | ✓ | ✓ | View/edit own profile |  |
| `GET /api/v1/verify/c/:certificateNo` | public | public | public | public | Public certificate/receipt verification |  |
| `POST /api/v1/verify/c/:certificateNo/name-check` | public | public | public | public | Public certificate/receipt verification |  |
| `GET /api/v1/verify/keys` | public | public | public | public | Public certificate/receipt verification |  |
| `GET /api/v1/verify/r/:receiptNo` | public | public | public | public | Public certificate/receipt verification |  |
| `GET /health` | public | public | public | public | Operations: health, readiness, metrics (bearer token) |  |
| `GET /metrics` | token | token | token | token | Operations: health, readiness, metrics (bearer token) | Bearer METRICS_TOKEN. |
| `GET /ready` | public | public | public | public | Operations: health, readiness, metrics (bearer token) |  |
