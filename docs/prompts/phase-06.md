# Phase 06 — Officer work queues and review workflow

Implement Phase 6: officer review. Plan first; reuse ApplicationStateService from Phase 4.

- Work queues of QUEUED applications per department, ordered by SLA due date then submit time, filtered by service, status, SLA risk, assignee; claim (A8), release/claim expiry after 2 working days (A9, job), reassign by supervisor (A10); optimistic locking so two officers can't act on the same application
- Review screen: applicant data (PII masked by default; unmask is audited), documents viewer, assessment, payment status, full history timeline
- Actions per @docs/STATE_MACHINES.md §1: request correction (A11: flagged fields/documents with comments, 30-day deadline, max 3 rounds; deadline job A13 → ABANDONED with 7-day and 1-day reminders), approve (A16), forward to supervisor (A17), reject (A21: reason code + citizen-visible note)
- Approval guards (FR-075): paid in full, required appointment ATTENDED, no open correction, no unresolved chargebackFlag
- Approval mode per service: proof of address SINGLE; birth certificate always needs supervisor second approval (A17 → A18); police "no record" SINGLE, "record found" → AWAITING_SUPERVISOR → supervisor confirms REFERRED (A19) or returns (A20). The second approver must be a different user
- Certificates per @docs/STATE_MACHINES.md §4: number {prefix}-YYYY-NNNNNN, expiry from validityMonths (birth: none), QR code, Ed25519 signature via the Phase 5 SigningService; PDF rendered by a job; issuing for a subject with an older VALID certificate revokes it as SUPERSEDED (C3)
- Public verification page /verify/c/{no}: type, number, status VALID/EXPIRED/REVOKED, dates, masked holder name, plus a rate-limited name-match check returning only match/no-match; never ID numbers, addresses, parents or record content
- Supervisors revoke with reason FRAUD/ERROR/CHARGEBACK + note (C2); supervisors resolve the chargeback flag (keep or revoke)
- Duplicate certificates: citizen orders a copy of a VALID certificate (kind DUPLICATE), pays the per-copy fee, and the copy is issued automatically with a new number linked to the original (A6)
- Citizen sees correction requests, edits and resubmits; history keeps every round
- SLA timer per application with working-day calculation (Holiday table; working week from settings, open item O-6); paused while CORRECTION_REQUESTED or AWAITING_APPOINTMENT; at-risk at 80%, overdue at 100%
- In-person step per service: police clearance always FINGERPRINTS; birth certificate always APPEARANCE (record attendee names); proof of address none. Officer schedules (A14), citizen is emailed, officer records ATTENDED or NO_SHOW (A15); max 2 reschedules
- Police clearance with a record found: officer note stored encrypted; no details online or in email; no certificate; citizen is told only to visit CID in person

Tests:
- Each role sees only its queue; officer from another department gets 403
- Concurrent claim: exactly one wins
- Full loop: submit → pay → claim → correction requested → resubmit → approve → certificate issued → public verify shows VALID → revoke → shows REVOKED
- Birth: officer approve → supervisor approve issues; same user cannot give both approvals (403)
- Police record found → REFERRED, no certificate created, email contains no reason
- Claim expiry returns the application to QUEUED; 4th correction round is rejected
- Playwright: officer processes an application on desktop
