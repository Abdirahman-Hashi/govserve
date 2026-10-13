# GovServe Revenue & Service Portal — Functional Specification

- Version: 1.0 (Phase 0), 2026-10-13
- Inputs: docs/DECISIONS.md (settled), docs/SERVICES.md (pilot services), Phase 0 interview
- Companion docs: docs/DATA_MODEL.md, docs/STATE_MACHINES.md, docs/adr/

## 1. Summary
GovServe is a secure, mobile-first web application for the Banadir Regional Administration (Mogadishu, Somalia).
It lets **individual citizens** apply online for three documents: proof of address, police clearance and
late birth registration. Citizens pay in USD and download a digitally signed, QR-verifiable certificate. Government
officers process the applications through department work queues. Supervisors give second approvals and confirm
high-value payments. Admins configure the system.

Stack: React 19 + TypeScript (web), NestJS 11 + Prisma (API), PostgreSQL 16, Redis + BullMQ, S3-compatible
storage, OpenAPI/Swagger, Docker. See the ADRs.

## 2. Roles and departments
| Role | Who | Scope |
| --- | --- | --- |
| citizen | Self-registered individual | Only their own account, applications, payments, certificates |
| officer | Staff, invited by admin | Exactly one department; that department's queue and payments |
| supervisor | Staff, invited by admin | Exactly one department; everything an officer can do there, plus second approvals, high-value confirmations, refunds, revocation, reassignment, reports, read-only audit |
| admin | Staff, invited by admin | System-wide configuration and users; **does not** review applications or confirm payments |

Departments: **Address Office** (proof of address), **Police / CID** (police clearance), **Civil Registry** (birth
certificate). A user has exactly one role. Staff have exactly one department, except admins, who have none.

### 2.1 Permission matrix
✓ = allowed, D = own department only, O = own records only, — = denied (403).

| Action | citizen | officer | supervisor | admin |
| --- | --- | --- | --- | --- |
| Register / verify email / reset password | ✓ | — | — | — |
| View/edit own profile | O | ✓ | ✓ | ✓ |
| Browse service catalogue | ✓ | ✓ | ✓ | ✓ |
| Create/edit/delete draft, submit, withdraw | O | — | — | — |
| Upload documents, respond to corrections | O | — | — | — |
| Submit mobile-money/bank payment evidence; pay by card | O | — | — | — |
| View own applications, payments, receipts, certificates | O | — | — | — |
| Order a duplicate certificate | O | — | — | — |
| View department queue, claim, review | — | D | D | — |
| Request correction, schedule/complete appointment | — | D | D | — |
| Approve (single-approval services) / reject | — | D | D | — |
| Propose REFERRED (police) / forward for second approval | — | D | D | — |
| Second approval (birth, police referral) | — | — | D (not the same user who did the first review) | — |
| Record cash payment; confirm/reject manual payment ≤ threshold | — | D | D | — |
| Confirm manual payment > threshold (second confirmation) | — | — | D (not the same user who did the first confirmation) | — |
| Confirm card payment | — (webhook only) | — | — | — |
| Reassign / release claims | — | — | D | — |
| Approve refund; resolve chargeback flag | — | — | D | — |
| Revoke certificate | — | — | D | — |
| Search applications/transactions | O | D | D | — |
| Dashboard and reports; CSV export | — | — | D | ✓ (all depts) |
| Audit log viewer (read-only) | — | — | D | ✓ |
| Manage staff users, departments, roles | — | — | — | ✓ |
| Manage services, service versions, fees, settings | — | — | — | ✓ |
| Public certificate/receipt verification | public | public | public | public |

## 3. Functional requirements

### 3.1 Accounts and authentication
- **FR-001** A citizen registers with full name, email (required, unique), phone and password. The account stays
  unverified until the citizen enters a 6-digit email one-time code (valid 10 minutes, max 5 attempts).
- **FR-002** Unverified accounts cannot submit applications. Unverified accounts are deleted after 7 days.
- **FR-003** Password policy: minimum 10 characters, checked against a common-password list, hashed with argon2id.
- **FR-004** After 5 failed logins in 15 minutes the account is locked for 15 minutes. The response is the same for unknown and locked accounts.
- **FR-005** Password reset uses an emailed one-time code. A successful reset revokes all of the user's sessions.
- **FR-006** Sessions use a JWT access token (15 min) plus a rotating refresh token in an httpOnly, Secure,
  SameSite=Strict cookie. Reuse of a rotated refresh token revokes the whole token family (ADR-0003).
- **FR-007** Staff accounts are created only by an admin through an invitation email with a one-time link (72 h).
  On first sign-in the staff member sets a password.
- **FR-008** Staff sign in with a password plus an emailed one-time code on every new or untrusted device. A device stays
  trusted for 30 days.
- **FR-009** Admins can deactivate a staff account. Deactivation revokes the user's sessions immediately and releases their claims.
- **FR-010** Citizens can view and edit their profile. Changing the email requires verifying the new address.

### 3.2 Authorization
- **FR-011** Every endpoint declares its roles. Endpoints without an explicit decision are denied.
- **FR-012** Citizen endpoints enforce ownership. Another citizen's record returns 404 (no existence leak).
- **FR-013** Staff endpoints enforce department scope. A record from another department returns 403.
- **FR-014** Second approvals and second payment confirmations must be made by a different user than the first.

### 3.3 Service catalogue and forms
- **FR-020** Admins manage Services (code, name, description, department, active, SLA working days, in-person
  step type, approval mode: SINGLE or SUPERVISOR_SECOND, validity months or none).
- **FR-021** Each Service has immutable published **ServiceVersions**. A version holds the form schema (JSON Schema), UI
  schema, required documents (type, allowed MIME, max size, required/one-of group) and fee rule (base cents,
  per-copy cents). Editing a published version creates a new draft version.
- **FR-022** Only one version per service is current at a time. An application stays on the version it was created with.
- **FR-023** Citizens browse the catalogue and see requirements, documents, the fee estimate and the target processing time.
- **FR-024** The three pilot services are seeded from docs/SERVICES.md with TEST fees flagged in the admin UI
  until the owner confirms them.

### 3.4 Applications and documents
- **FR-030** A citizen creates a draft for a service and subject. Drafts autosave. The citizen can delete a draft at any time.
- **FR-031** The system blocks a new application when the same citizen already has an open application for the same
  service and subject. Open means not ISSUED, REJECTED, REFERRED, WITHDRAWN or ABANDONED.
- **FR-032** Subject: proof of address and police clearance are always for the applicant. A birth certificate is for the
  applicant or a child, and the applicant's relationship (mother, father, guardian, self) is recorded.
- **FR-033** On submit the server validates the form against the version's schema and checks that the required documents
  are present and clean. Any error returns 422 with field-level details.
- **FR-034** Each application gets a reference number `GS-YYYY-NNNNNN` from a DB sequence.
- **FR-035** Uploads use a pre-signed PUT (≤5 MB; PDF, JPEG, PNG checked by magic bytes). The server stores the SHA-256 checksum.
  Files are QUARANTINED until the virus-scan port marks them CLEAN. Downloads use short-lived signed GETs issued
  after an authorization check.
- **FR-036** The web client compresses images before upload. Uploads can be retried and replaced.
- **FR-037** The citizen chooses the number of extra certified copies (0–5) before submit.
- **FR-038** A citizen can withdraw a submitted application at any point before a decision.
- **FR-039** The citizen sees a status timeline with every transition, correction round and appointment.

### 3.5 Fees
- **FR-040** On submit the server computes an immutable **FeeAssessment** from the version's fee rule:
  `base + perCopy × extraCopies`. It stores the line items, the total in integer cents and a snapshot of the rule. The client never
  supplies an amount.
- **FR-041** There are no waivers, penalties, express fees or manual overrides at launch. Changing a fee means publishing a
  new ServiceVersion (an audited admin action) and never alters existing assessments.
- **FR-042** A duplicate-certificate request is assessed at `perCopy × copies` (min 1) from the current version of
  the original's service.

### 3.6 Payments
- **FR-050** Channels: mobile money, bank transfer/deposit, cash at a counter, card. Amounts are in USD integer cents.
- **FR-051** Mobile money / bank: the citizen submits the channel, provider (e.g. EVC Plus, Sahal, bank name), transaction ID or
  slip number, amount, paid date and an optional screenshot or slip photo. The payment enters PENDING_VERIFICATION in the
  department's verification queue.
- **FR-052** A (channel, provider, reference) combination must be unique across all payments that are not REJECTED. Duplicates return 409.
- **FR-053** An officer confirms or rejects a manual payment. Rejection requires a reason code and note.
- **FR-054** When a manual payment's amount is **greater than the threshold** (setting, default 10000 cents = $100.00),
  the first confirmation moves it to AWAITING_SUPERVISOR. A supervisor other than the first confirmer must confirm
  it before it counts.
- **FR-055** Cash: an officer records amount, receipt-book reference and payer at the counter. The same threshold
  rule applies.
- **FR-056** Card: payments are initiated through the CardGateway port (mock adapter at launch) with an
  Idempotency-Key. They are confirmed **only** by a signed webhook (HMAC, ±5 min timestamp tolerance, idempotent on
  provider reference). A reconciliation job polls INITIATED card payments older than 15 minutes.
- **FR-057** Partial payments add up. When confirmed payments ≥ the assessed total, the application moves to QUEUED
  in the same transaction. Any excess is an overpayment that can be refunded.
- **FR-058** Refunds are allowed only for a duplicate payment, an overpayment, or a withdrawal before review started (the application
  was never claimed). An officer or the citizen's withdrawal creates a refund request. A supervisor approves it and records the payout
  method and reference. Card refunds go through the gateway. There is no refund on rejection or referral.
- **FR-059** A card chargeback or reversal webhook sets the payment to REVERSED and sets `chargebackFlag` on the
  application. A supervisor resolves the flag by recording a decision (keep, or revoke the certificate with reason
  CHARGEBACK). Nothing happens automatically.
- **FR-060** Every CONFIRMED payment produces a receipt: a gap-free number per fiscal year (`R-YYYY-NNNNNN`, locked
  counter row) and a signed PDF with a QR code. Public receipt verification shows only receipt number, service, amount,
  date and status (VALID/REFUNDED/REVERSED), with no PII.
- **FR-061** A PaymentProvider port exists so automatic mobile-money confirmation can be added later.

### 3.7 Review workflow and appointments
- **FR-070** Each department has a work queue of QUEUED applications, ordered by SLA due date and then submit time. It can be filtered by
  service, status, SLA risk and assignee.
- **FR-071** An officer claims the next application (or a specific one). The claim uses optimistic locking so exactly one
  claimant wins. A claim expires after 2 working days with no activity and the application returns to the queue.
  Supervisors can reassign or release any claim in their department.
- **FR-072** The review screen shows form data (PII masked by default; unmasking is audited), documents, assessment,
  payments and the full timeline.
- **FR-073** Request correction: the officer flags specific fields and documents, each with a comment. Only those items unlock for
  the citizen. Deadline 30 days, then ABANDONED by a scheduled job. Max 3 rounds; a 4th request is blocked.
- **FR-074** Appointments: police clearance (fingerprints) and birth certificate (parents/witnesses appear) need
  an appointment. The officer sets the date, time and location; the citizen is emailed. The officer records ATTENDED (with attendee
  names for birth) or NO_SHOW. After a no-show the appointment can be rescheduled up to 2 times, after which the
  application can be rejected. The SLA clock pauses while AWAITING_APPOINTMENT.
- **FR-075** Approval requires: payment complete, every required appointment ATTENDED, no open correction request,
  and no unresolved chargeback flag.
- **FR-076** Proof of address: officer approval issues the certificate.
- **FR-077** Birth certificate: officer approval sends the application to AWAITING_SUPERVISOR. A supervisor (not the
  reviewing officer) approves to issue, or returns it to IN_REVIEW with a note, or rejects it.
- **FR-078** Police clearance: "no record" approval by the officer issues the certificate. "Record found" sends the application to
  AWAITING_SUPERVISOR with an encrypted note. A supervisor confirms REFERRED or returns it to IN_REVIEW. A REFERRED
  application never produces a certificate. The citizen is told only to visit CID in person.
- **FR-079** Reject requires a reason code (from a configurable list) and a note visible to the citizen.
- **FR-080** Business-day SLA timer per application (configurable holidays, Saturday–Thursday working week by default, OPEN).
  Applications are flagged at risk at 80% of the SLA and overdue at 100%.

### 3.8 Certificates and verification
- **FR-090** On issue, the system generates a certificate PDF with: certificate number (`{SVC}-YYYY-NNNNNN`), service type, holder
  name, the service-specific fields, issue date, expiry (proof of address and police: issue + validity months; birth: none), QR
  code, and an Ed25519 signature over a canonical payload with keyId (ADR-0006).
- **FR-091** The citizen can download their certificates and receipts at any time.
- **FR-092** The public verification page `/verify/c/{certNo}` shows type, number, status (VALID, EXPIRED, REVOKED),
  issue and expiry dates, and a masked holder name. The verifier can submit a full name and gets only a match or no-match answer.
  The page is rate-limited (10/min/IP for name checks). It never shows ID numbers, addresses, parents or record content.
- **FR-093** Supervisors revoke certificates with a reason (FRAUD, ERROR, CHARGEBACK, SUPERSEDED) and a note.
  The public page shows REVOKED and the revocation date only.
- **FR-094** A citizen can order a duplicate of a VALID certificate (FR-042). After payment, a new certificate number is
  issued automatically (no review), linked to the original, with the same expiry.
- **FR-095** When a new certificate is issued for the same service and subject while an older one is VALID, the older one is
  revoked as SUPERSEDED in the same transaction.

### 3.9 Notifications
- **FR-100** Email notifications for: verification and reset codes, staff invitation and device code, submitted, payment
  received or confirmed or rejected, correction requested, correction deadline reminder (7 days and 1 day before), appointment
  scheduled or changed, approved or certificate issued, rejected, referred, withdrawn, refund processed, and SLA breach (to the
  department supervisor).
- **FR-101** Emails contain only the first name, reference number and a portal link. They never contain other PII or the reason
  for a police referral.
- **FR-102** Delivery runs through a channel-agnostic NotificationPort over BullMQ, with retries and a dead-letter queue. Each send is idempotent
  per event, channel and recipient. Transactional messages cannot be opted out of.

### 3.10 Search and history
- **FR-110** Citizens list and filter their applications, payments, receipts and certificates.
- **FR-111** Staff search within their scope by reference number, receipt number, certificate number, applicant name, national ID
  (blind index), phone (blind index), date range, status, channel and amount range. Results use keyset pagination.
- **FR-112** Supervisors export search results as CSV (row cap 50,000). Exports are audited.

### 3.11 Dashboard
- **FR-120** Supervisors (own department) and admins (all departments) see: collections (confirmed − refunds −
  reversals) by service, channel and day; outstanding assessed but unpaid amounts; applications by status; submitted vs completed per
  week; median and p90 submit-to-decision time; SLA compliance %; overdue count; queue size and oldest item per
  officer.
- **FR-121** Every figure reconciles to the transaction tables to the cent. A drill-down opens the underlying filtered list.

### 3.12 Audit
- **FR-130** Every application status change, payment event, certificate event, claim or reassignment, PII unmask, export, and
  admin action (users, services, versions, settings) writes an AuditLog row **in the same transaction**.
- **FR-131** AuditLog is append-only (the DB role has no UPDATE or DELETE) and hash-chained. A verifier job reports the first broken link.
- **FR-132** Supervisors (own department) and admins have a read-only audit viewer.

### 3.13 Administration
- **FR-140** Admins manage staff (invite, change role or department, deactivate), departments, services and versions,
  reject and revoke reason codes, holidays, and settings (payment threshold, correction deadline, claim expiry, retention periods).
  Every change is audited with before and after values.

### 3.14 Retention
- **FR-150** Issued certificates, receipts, payments and the audit log are retained indefinitely.
- **FR-151** Uploaded documents are deleted 7 years (setting) after the application's final decision. The metadata row and
  checksum stay.
- **FR-152** Drafts untouched for 90 days, and ABANDONED or WITHDRAWN applications' uploads after 90 days, are purged by a
  scheduled job that writes an audit entry.

## 4. Non-functional requirements
- **NFR-001 Security:** OWASP ASVS Level 2 target. Helmet and CSP, CORS allowlist, rate limiting on auth and verification
  endpoints, CSRF protection for cookie-authenticated refresh.
- **NFR-002 PII encryption:** national ID, phone, date of birth, mother's full name and parents' ID numbers are encrypted at
  rest (AES-256-GCM, field level, key from the environment and KMS-ready). National ID and phone also get a blind index
  (HMAC-SHA-256) for search. Police "record found" notes are also encrypted.
- **NFR-003 Logging:** structured JSON logs with request IDs. Tokens, passwords, OTPs and decrypted PII are never logged.
- **NFR-004 Money:** USD only, integer cents as BigInt in DB and code, serialized as strings in JSON. No floats.
- **NFR-005 Bandwidth:** mobile-first from 360 px width. Initial JS ≤ 250 KB gzipped. Key pages are interactive in ≤ 5 s on
  throttled 3G. Images are compressed on the client. Drafts autosave. There is no offline mode.
- **NFR-006 Performance:** API p95 ≤ 500 ms for reads and ≤ 1 s for writes, at 200 concurrent users browsing, 50 submitting and 20 paying.
- **NFR-007 Availability:** single-VM Docker Compose target with 99.5% monthly availability, nightly backups, RPO 24 h and RTO 4 h.
- **NFR-008 Accessibility:** WCAG 2.1 AA on citizen and officer pages.
- **NFR-009 i18n-ready:** English only, with all UI strings in one catalogue.
- **NFR-010 API:** REST under `/api/v1`, OpenAPI 3 documentation, error envelope `{ error: { code, message, details, requestId } }`.
- **NFR-011 Portability:** every external dependency (gateway, email, storage, virus scan, mobile money) sits behind a port
  with a mock adapter. Hosting target is TBD (DECISIONS.md).
- **NFR-012 Observability:** /health, /ready and /metrics endpoints. Alerts on 5xx rate, webhook failures, queue backlog and audit-chain breaks.
- **NFR-013 Time:** timestamps are stored in UTC and displayed in Africa/Mogadishu (EAT, UTC+3).
- **NFR-014 Testing:** unit, integration (Testcontainers) and Playwright e2e tests. Every authorization rule has a negative test, and every transition has an allowed and a disallowed test.

## 5. Out of scope at launch
Business or organisation accounts; SMS; languages other than English; automatic mobile-money APIs; real card gateway;
fee waivers, penalties and express service; copies of birth registrations made before GovServe; offline mode;
integration with criminal-record systems.

## 6. Open items
| # | Item | Owner | Needed by |
| --- | --- | --- | --- |
| O-1 | Official fees (base, per copy) for all three services | Abdirahman Hashi | Go-live (config only) |
| O-2 | Official validity of proof of address and police clearance | Abdirahman Hashi | Go-live |
| O-3 | Official target processing times | Abdirahman Hashi | Go-live |
| O-4 | Exact signing office or official title per certificate | Abdirahman Hashi | Phase 06 (PDF template) |
| O-5 | Legal sign-off on retention periods and masked-name verification | Abdirahman Hashi | Phase 12 |
| O-6 | Working week and public holiday calendar | Abdirahman Hashi | Phase 06 |
| O-7 | Card gateway choice | Abdirahman Hashi | Before real card payments |
| O-8 | Hosting target | Abdirahman Hashi | Phase 11 |
