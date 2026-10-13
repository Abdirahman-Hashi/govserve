# Phase 00 — Spec, data model and decisions (no code)

We are building GovServe, a government revenue and service portal. Read @docs/SPEC.md (the product brief), @docs/SERVICES.md (the three pilot services) and @docs/DECISIONS.md (already settled: do not re-ask these, build on them).

Interview me in detail using the AskUserQuestion tool before writing anything. Dig into the hard parts:
- Exactly what each role can do (citizen, officer, supervisor, admin) and which department each officer belongs to
- Application lifecycle states and every allowed transition, including corrections and resubmission
- Fee rules: flat, tiered, per-unit, penalties, waivers; who can override and how it is audited
- Payment details within DECISIONS.md: what evidence citizens submit per channel, the USD threshold that needs supervisor confirmation, partial payments, refunds and reversals
- Receipt verification: what a third party sees when scanning the QR code
- Every 'Confirm' item in @docs/SERVICES.md for proof of address, police clearance and birth certificate: issuing authority, accepted documents, fees (USD), validity, processing time, in-person steps (fingerprints, field visit, witnesses), how a positive criminal record is handled
- Certificate lifecycle: issue, expiry, revocation, re-issue/duplicate copies
- Data retention, PII fields, offline/low-bandwidth expectations
Don't ask obvious questions. Keep going until the gaps are closed.

Then write:
0. Update docs/SERVICES.md with the confirmed answers (no 'Confirm' left, or a named owner for each open item)
1. docs/SPEC.md — complete functional spec with numbered requirements (FR-001…) and non-functional ones (NFR-…)
2. docs/DATA_MODEL.md — entities, fields, relations, indexes, and a Mermaid ER diagram
3. docs/STATE_MACHINES.md — application and payment state machines as Mermaid stateDiagrams + transition tables (from, to, actor role, guard, side effects, audit event)
4. docs/adr/0001…0006 — ADRs (use docs/adr/0000-template.md) for: monorepo layout, ORM (Prisma), auth (JWT access + rotating refresh), file storage (S3-compatible), job queue (BullMQ), receipt signing
5. Review docs/prompts/phase-01…12 and tell me what to change in them given the spec.

No application code in this phase. Done when I approve the four documents.
