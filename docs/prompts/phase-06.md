# Phase 06 — Officer work queues and review workflow

Implement Phase 6: officer review. Plan first; reuse ApplicationStateService from Phase 4.

- Work queues filtered by department, service, status, SLA risk; assignment (claim, assign, reassign by supervisor); optimistic locking so two officers can't act on the same application
- Review screen: applicant data (PII masked unless the officer has the permission), documents viewer, assessment, payment status, full history timeline
- Actions: request correction (with per-field/document comments), approve, reject (reason code + note), confirm manual payment, escalate to supervisor
- Approve requires payment CONFIRMED unless the service is fee-exempt; on approval, issue the service's certificate PDF (address certificate, police clearance, birth certificate) with a certificate number, validity dates, QR code and Ed25519 signature, reusing the signing service from Phase 5; public verification page shows only type, number, holder name, dates and VALID/EXPIRED/REVOKED; supervisors can revoke with a reason
- Citizen sees correction requests, edits and resubmits; history keeps every round
- SLA timer per application with business-day calculation; overdue flag
- Optional per-service in-person step (e.g. fingerprints for police clearance, field visit for address): officer schedules an appointment, citizen is emailed, officer records completion before approval
- Police clearance with a record found: no details online; certificate is not issued automatically, citizen is told to collect in person
- Four-eyes rule configurable per service (approval needs a second officer)

Tests:
- Each role sees only its queue; officer from another department gets 403
- Concurrent claim: exactly one wins
- Full loop: submit → correction requested → resubmit → approve → certificate issued → public verify shows VALID → revoke → shows REVOKED
- Playwright: officer processes an application on desktop
