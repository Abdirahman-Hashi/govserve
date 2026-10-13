# Phase 04 — Applications and document uploads

Implement Phase 4: citizens submit applications with supporting documents. Follow the application state machine in @docs/STATE_MACHINES.md exactly. Plan first.

Backend:
- Application (reference number e.g. GS-2026-000123 from a DB sequence, applicant, serviceVersion, formData JSON, status, submittedAt), ApplicationDocument, ApplicationStatusHistory
- Draft → Submitted flow: save drafts, validate formData against the version's JSON Schema server-side, check required documents present before submit
- Uploads: pre-signed PUT URLs to S3/MinIO; server verifies size, MIME by magic bytes (not extension), SHA-256 checksum; files private, downloads only via short-lived signed GET after an authorization check
- Virus-scan hook as a port (ClamAV adapter in docker-compose, no-op in unit tests); quarantine status until clean
- A single ApplicationStateService performs every transition: checks actor role + guard, writes status history and AuditLog in one transaction, emits a domain event
- Citizens may edit only in DRAFT or CORRECTION_REQUESTED
- Applicant vs subject: the applicant is the logged-in citizen; the subject is who the document is about (self, or a child for birth certificates, with the applicant's relationship recorded)

Frontend:
- Multi-step apply wizard from formSchema; document checklist with upload progress, retry and replace; autosave drafts; review-and-submit page; "My applications" list and detail timeline
- Works on a 360px-wide phone and on slow 3G (test with throttling)

Tests:
- State machine: every allowed transition succeeds, every disallowed one returns 409 with no side effects
- Upload: wrong MIME, oversized, missing required doc, accessing another user's file (403)
- Playwright: complete an application end to end on mobile viewport
