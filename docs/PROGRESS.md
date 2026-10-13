# GovServe build progress

Tick a phase only when lint, typecheck and tests are green and the phase's acceptance checks pass.

| Phase | Delivers | Depends on | Status |
| --- | --- | --- | --- |
| 00 | Spec, data model, state machines, ADRs (no code) | — | [x] |
| 01 | Monorepo scaffold, Docker Compose, CI skeleton | 00 | [x] |
| 02 | Auth, JWT, RBAC, users | 01 | [x] |
| 03 | Service catalogue + configurable forms + fee engine | 02 | [x] |
| 04 | Applications + document uploads | 03 | [x] |
| 05 | Fee assessment, payments, verifiable receipts | 04 | [x] |
| 06 | Officer work queues + review workflow | 04, 05 | [x] |
| 07 | Email notifications | 06 | [ ] |
| 08 | Search + application/transaction history | 06 | [ ] |
| 09 | Management dashboard | 05, 06 | [ ] |
| 10 | Audit trail hardening + OpenAPI polish | 02–09 | [ ] |
| 11 | Production Docker, CI/CD, cloud deploy | 10 | [ ] |
| 12 | Security review, load test, UAT fixes | 11 | [ ] |

## Notes
<!-- /ship appends a short note per phase: what changed, follow-ups, decisions -->

**Phase 00 (2026-10-13):** Approved SERVICES, SPEC (FR/NFR, permission matrix), DATA_MODEL and STATE_MACHINES; ADRs 0001–0006 accepted; Phase 0 decisions recorded in DECISIONS.md; phase 01–12 prompts aligned with the spec.
Follow-ups: open items O-1 to O-8 in SPEC §6 (owner: Abdirahman Hashi): official fees, validity, SLAs, signing offices, legal retention sign-off, holiday calendar, card gateway, hosting target.

**Phase 01 (2026-10-13):** pnpm + Turborepo monorepo (api NestJS 11 + Prisma 7, web React 19 + Vite, shared Zod/money/fees/enums), Docker Compose (Postgres on host port 5433, Redis AOF, RustFS object store per ADR-0007, Mailpit, ClamAV under `--profile scan`), error envelope, deny-by-default guard, redacted pino logs, /health and /ready, Swagger, Testcontainers, Playwright, CI.
Follow-ups: web bundle is 198 KB gz of the 250 KB budget, so lazy-load routes in Phase 02; the `Read(./.env.*)` deny rule also blocks editing `.env.example`.

**Phase 02 (2026-10-13):** Citizen registration with email OTP, login with lockout, staff email-OTP device trust, JWT access + rotating refresh with reuse detection and Redis session revocation, admin-only staff invitations/role changes/deactivation, AES-256-GCM PII encryption with blind indexes, AuditLog (same-transaction writes), BullMQ purge of unverified accounts, admin bootstrap and permissions-matrix scripts; web auth pages, role-guarded lazy routes, profile and staff admin.
Follow-ups: release claims on deactivation (Phase 06); audit hash chain and insert-only grants (Phase 10); main web bundle still 195 KB gz (mostly zod/react-dom); citizen ownership returns 404 per FR-012 (prompt said 403).

**Phase 03 (2026-10-13):** Service catalogue with immutable versioned forms (JSON Schema subset validated by the same `validateFormData` in browser and API, no runtime codegen), required documents with any-one-of groups, base + per-copy fee rule, publish/retire with one live version per service; settings, holidays and reason codes; idempotent seed of the three pilot services (TEST fees) plus defaults; public catalogue with fee estimate and form preview; admin version editor with live preview.
Follow-ups: official fees/validity/SLAs still O-1–O-3 (seed is TEST); district list and ID format unconfirmed (free text / generic pattern); main web bundle 204 KB gz, so add per-module subpath exports in packages/shared to keep the form validator out of the entry chunk; seed does not audit default settings/reason codes (system setup).

**Phase 04 (2026-10-13):** Applications with the full A1–A22 transition table in ApplicationStateService (history + AuditLog + outbox per transition, optimistic locking, 409 for every disallowed move), drafts with autosave, submit (form + document checks, GS reference, immutable FeeAssessment), withdraw, delete, idle-draft purge; correction field locking; one open application per subject; private uploads via pre-signed PUT with size/content-type/SHA-256 verification, quarantine and virus-scan port (ClamAV/noop), every document change audited; citizen wizard, checklist, status page; session refresh rate limit raised to 60/min (shared carrier NAT).
Follow-ups: verify the ClamAV adapter against a real clamd (`--profile scan`) before Phase 11; refunds on withdrawal (Phase 05) and resubmission A12 (Phase 06); outbox relay in Phase 07; web entry bundle 205.6 KB gz.

**Phase 05 (2026-10-13):** Payments (mobile money/bank evidence, cash desk, card via CardGateway port + mock with real HMAC webhooks, reconciliation) through a payment/refund state service (P1–P11, R1–R6) with event + audit + outbox per change; >$100 manual payments need a second, different supervisor; partial payments queue the application at the full fee (A5) with working-day SLA, overpayment recorded; refunds capped under row lock, auto-requested on withdrawal before review and A7 abandonment; gap-free Ed25519-signed receipts (PDF on demand, QR → public /verify/r with client-side signature check); officer queue, review, cash desk and supervisor refunds UI.
Follow-ups: choose the real card gateway (O-7) and mobile-money list (O-9); browser-level staff fixtures for e2e (Phase 06); duplicate-certificate payments A6 (Phase 06); web entry bundle 207 KB gz.

**Phase 06 (2026-10-14):** Department work queues with SLA risk (working days, paused during corrections and appointments), claim/claim-next/release/assign with optimistic versions and a claim-expiry job; masked review screen with audited unmask; corrections (max 3 rounds, 30-day deadline job with 7/1-day reminders, resubmit only when flagged items change), fingerprint/appearance appointments, approve, police referral (encrypted note), reject, supervisor second approval enforced by service and DB trigger; signed QR certificates (PDF on demand), supersede, paid duplicates (A6), supervisor revoke and chargeback resolution, public /verify/c with rate-limited name check; officer queue/review, citizen corrections and certificates UI; e2e staff fixture and desktop officer flow.
Follow-ups: supervisor assign UI needs a staff picker; appointment/correction/decision emails ship with the Phase 07 outbox relay; legal wording per certificate (O-4); web entry bundle about 225 KB gz (208 KB index + 17 KB strings).
