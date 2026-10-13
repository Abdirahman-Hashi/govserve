# Phase 04 — Applications and document uploads

Implement Phase 4: citizens submit applications with supporting documents. Follow the application state machine in @docs/STATE_MACHINES.md exactly. Plan first.

Backend:
- Application, ApplicationData (encrypted PII columns), Document, ApplicationStatusHistory, OutboxEvent per @docs/DATA_MODEL.md §3 and §6 (reference number GS-YYYY-NNNNNN from a DB sequence, assigned on submit; kind STANDARD/DUPLICATE; subjectKey; extraCopies 0–5)
- DRAFT → AWAITING_PAYMENT (transition A3): save and autosave drafts, validate formData against the version's JSON Schema server-side, check required documents present and CLEAN before submit; create the FeeAssessment on submit (fee function from Phase 3)
- One open application per service + subject (FR-031): partial unique index plus a friendly 409
- Delete draft (A2) and withdraw (A22) for the citizen; idle-draft purge job (A4)
- Uploads: pre-signed PUT URLs to S3/MinIO; server verifies size, MIME by magic bytes (not extension), SHA-256 checksum; files private, downloads only via short-lived signed GET after an authorization check
- Virus-scan hook as a port (ClamAV adapter in docker-compose, no-op in unit tests); quarantine status until clean
- A single ApplicationStateService performs every transition: checks actor role + department scope + guard, writes status history, AuditLog and an OutboxEvent in one transaction (ADR-0005), with an optimistic version check
- Citizens may edit only in DRAFT, or in CORRECTION_REQUESTED where only the flagged CorrectionItems are unlocked (enforced server-side)
- Applicant vs subject: the applicant is the logged-in citizen; the subject is who the document is about (self, or a child for birth certificates, with the applicant's relationship recorded)

Frontend:
- Multi-step apply wizard from formSchema; document checklist with upload progress, retry and replace; autosave drafts; review-and-submit page; "My applications" list and detail timeline
- Works on a 360px-wide phone and on slow 3G (test with throttling)

Tests:
- State machine: every allowed transition succeeds, every disallowed one returns 409 with no side effects
- Upload: wrong MIME, oversized, missing required doc, accessing another user's file (403)
- Playwright: complete an application end to end on mobile viewport
