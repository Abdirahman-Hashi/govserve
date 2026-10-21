# GovServe — decisions already made

Settled before Phase 0 (2026-10-13). Phase 0 should not re-ask these; it should build on them.
Change a decision only by editing this file and noting the date and reason.

## Who it serves and what
- GovServe serves **one user: the individual citizen**. No business/organisation accounts at launch.
- Three pilot services, detailed in docs/SERVICES.md:
  1. **Proof of address** (government-issued address / residence certificate)
  2. **Criminal record certificate** (police clearance)
  3. **Birth certificate**
- Every approved application issues a **digitally signed certificate PDF with a QR code** that anyone can verify
  on a public page. Supervisors can revoke certificates.
- Fees, issuing authorities and in-person steps are confirmed in Phase 0 from official sources, never guessed.

## Payments
- Currency: **USD only**, stored as integer cents.
- Channels at launch: **mobile money, bank transfer/deposit, cash at a government counter, card**.
- Confirmation:
  - **Mobile money and bank:** confirmed manually by an officer. The citizen submits the transaction ID
    or deposit-slip number, plus an optional screenshot or slip photo. The payment waits in a
    verification queue (PENDING_VERIFICATION) until an officer confirms or rejects it with a reason.
  - **Cash:** an officer records it at the counter with the receipt-book reference.
  - **Card:** confirmed **only** by the card gateway's signed webhook, never by an officer. The gateway
    is not chosen yet, so build behind a CardGateway port with a mock adapter.
  - Above a USD threshold (set in Phase 0), a **supervisor must also confirm** manual payments.
  - Duplicate transaction IDs / slip numbers are rejected.
- No automatic mobile-money API integration at launch. Keep a PaymentProvider port so one can be added later.

## Users and roles
- Public: **citizen** only.
- Staff: **officer** (reviews applications, verifies payments in their department), **supervisor**
  (reassigns work, escalations, second approval, waivers, payment confirmations above the threshold,
  reports, read-only audit view), **admin** (users, services, configuration).
- No separate finance or auditor role at launch. Their duties sit with supervisor; add roles later if needed.

## Communication
- **English only.** Keep UI strings in one place so translation can be added later.
- Notifications by **email only** (SMTP provider TBD; Mailpit in development).
  Account verification and password reset use emailed one-time codes, so an email address is required to register.
- Keep the notification port channel-agnostic so SMS can be added later without changing callers.

## Hosting
- **Not decided.** Build portable: Docker Compose on a single Linux VM is the default target.
  Confirm the real target before Phase 11.

## Phase 0 decisions (2026-10-13)
Settled in the Phase 0 interview. Details are in docs/SPEC.md, docs/SERVICES.md and docs/STATE_MACHINES.md.
- **Jurisdiction:** Somalia, Banadir Regional Administration (Mogadishu).
- **Departments:** one per service (Address Office, Police/CID, Civil Registry). Officers and supervisors belong to exactly one department.
- **Approval:** officer alone for proof of address and police "no record". A supervisor gives the second approval for every birth
  certificate and confirms every police "record found" referral (no certificate is issued; the citizen visits CID).
- **Supervisor payment threshold:** manual payments **> $100.00** (10000 cents), admin-configurable.
- **Fees:** flat base fee + per-copy fee only. No waivers, penalties, express service or overrides. Official amounts are OPEN
  (owner: Abdirahman Hashi). Seed values are marked TEST.
- **Pay before review**, full amount required. Partial payments add up toward the total.
- **Refunds** only for duplicate payments, overpayments, or a withdrawal before review starts (supervisor approves). No refund on rejection.
- **Card chargeback:** the payment becomes REVERSED and the application is flagged. A supervisor decides; nothing is revoked automatically.
- **Corrections:** only flagged items unlock; 30-day deadline, then ABANDONED; max 3 rounds.
- **Birth certificate:** late registration only; parents always appear in person.
- **Police clearance:** a fingerprint appointment is always required.
- **Certificates:** paid duplicates get a new number; a corrected re-issue supersedes the old one; the public page shows a masked name plus
  a name-match check.
- **Retention:** certificates, payments and audit kept indefinitely; uploads 7 years; idle drafts 90 days.
- **Work assignment:** officers pull from the department queue; claims expire after 2 working days.
- **Staff auth:** admin invitation; password + email OTP per new device.
- **One open application** per service and subject.
- **Encrypted PII:** national ID, phone, DOB, mother's full name, parents' ID numbers.
- **Bandwidth:** mobile-first, ≤250 KB initial JS, client-side image compression, autosave; no offline mode.

## Phase 06 decisions (2026-10-13)
- **Certificate PDFs are rendered on demand** from the signed payload (like receipts in Phase 05), not by a job, so there is no stored
  PDF to purge or keep in sync. Every download is audited (`CERTIFICATE_DOWNLOADED`).
- **Another department's application returns 403** (same as payments), not 404.
- **Resubmission needs real changes:** each flagged answer must differ from its keyed hash taken when the round opened, and each flagged
  document must be a clean upload made after the request.
- **The resubmitted application goes back to the same officer.** If they are no longer active, it returns to the queue.
- **Staff actions carry the version the officer saw** (optimistic locking). A stale action gets 409 `CONCURRENT_UPDATE`.
- **The police "record found" note is encrypted** (`ReviewDecision.noteEnc`). It never appears in audit details, the outbox or citizen views.
- **The supervisor "assign" action is API-only for now.** The UI needs a staff picker for supervisors, which is a follow-up.

## Phase 07 decisions (2026-10-14)
- **Codes and invitation links are sent directly**, never through the outbox or Redis, because they are one-time secrets.
  Each send is still logged, without the code (ADR-0008).
- **Appointment emails include the date, time and place.** None of these is personal data, and they are the point of
  the message. All other emails carry only the first name, the reference number and a portal link (FR-101).
- **Only three messages can be opted out of:** application submitted, payment details received and withdrawn. Codes,
  receipts, corrections, reminders, appointments, decisions, refunds and SLA alerts are always sent. In-app
  notifications are kept regardless of the preference.
- **SLA breach** is reported once per application (`slaBreachedAt`) to every active supervisor in the department. A job
  checks every 15 minutes.

## Phase 08 decisions (2026-10-14)
- **`GET /applications` returns keyset pages** (`{items, nextCursor}`), filtered by status, service, dates and part of the
  reference number. Citizens also get `GET /payments` (payments with receipt numbers).
- **Staff search and CSV export are POST with a JSON body.** National IDs, phone numbers and names never appear in URLs, so
  proxy logs, access logs and Referer headers can't leak them. Citizen history stays GET because its filters hold no PII.
- **Staff search is department-scoped and never shows drafts.** National ID matches the applicant's profile or the application
  subject; phone matches the applicant's account phone (form answers are encrypted without a blind index).
- **Name search** matches word prefixes in any order ('simple' full-text, no stemming).
- **Exports:** supervisors only, streamed, capped at 50,000 rows (`SEARCH_EXPORT_CAP`), with formula injection neutralised.
  Each export is audited (`SEARCH_EXPORTED`) with filter names and non-identifying values; name, national ID and phone are
  recorded only as "provided".
- **Query plans** for every search shape on 100,000 rows are in docs/perf/search-plans.md, regenerated by
  `test/int/search-plans.int-spec.ts`.

## Phase 09 decisions (2026-10-14)
- **Dashboard figures come from live SQL views**, not materialized views, so they always reconcile to the cent
  (ADR-0009).
- **Money movements are dated when they happen.** A reversal or refund lowers collections on its own day, not the
  original payment's.
- **"Completed" means decided** (ISSUED, REJECTED, REFERRED). Withdrawn and abandoned applications appear in the
  by-status counts only. Processing time runs from submit to decision (FR-120), so it includes time waiting for payment.
- **Snapshots vs ranges:** outstanding, overdue and pending work describe now. Collections, volumes, processing time and
  SLA compliance follow the date range (default: the last 30 days, Mogadishu time).
- **Scope:** supervisors are always limited to their own department; a requested `departmentId` is ignored and the
  response reports the applied scope. Admins see all departments or one. Admin drill-downs use the report list
  endpoints, because staff search is department-bound.
- **Charts** use `centsForChart` (exact up to 2^53 cents; it throws beyond that) for geometry only. Labels and tables
  use `formatUsd` on bigint cents. Recharts 3.10.1 loads only in the dashboard chunk.
- **Report CSV exports** are audited as `REPORT_EXPORTED` with the applied scope.

## Phase 10 decisions (2026-10-14)
- **The audit chain is computed by a database trigger** under an advisory lock, so every row is chained in commit order
  whoever writes it. A verifier with a checkpoint reports `ROW_CHANGED`, `LINK_BROKEN` or `TAIL_REMOVED` and notifies all
  admins (ADR-0010).
- **Two database roles:** the API runs as a member of `govserve_app_rw` (`DATABASE_APP_URL`; INSERT and SELECT only on audit
  tables). Migrations run as the owner (`DATABASE_URL`). Production refuses to start when both are the same user.
  Integration tests run as the restricted role.
- **Audit coverage is proven, not asserted:** docs/AUDIT_COVERAGE.md lists all 91 actions. A unit test keeps it in step with
  the code, and the integration run fails unless every listed action was actually written.
- **Audit viewer:** supervisors see only rows of their department (auth and admin rows have none, so they are admin-only).
  Exports are audited (`AUDIT_EXPORTED`).
- **Retention:** settings `retention.documentYears` (7), `retention.closedUploadDays` (90), `retention.unverifiedDays` (7)
  and `retention.pruneDays` (30). Files are deleted and their rows kept (`purgedAt`; the API shows `purged` and answers
  410). Each purge or prune writes an audit row. Dispatched outbox rows are pruned; notifications keep their own rows, and
  the in-app list filters by template.
- **API contract:** `info.version` is semver (1.10.0), with URIs at `/api/v1`. `apps/api/openapi.lock` and
  docs/API_CHANGELOG.md guard changes. Examples are generated from the schemas, with name-based values. `/health` and
  `/ready` stay outside `/api/v1` as load-balancer probes.
- **Gaps closed by the review:** signing-key registration and rotation, seeded settings and reason codes, auth-artifact
  pruning, and idle-draft document purges are now audited. Signing keys are no longer rewritten on every boot.


## Phase 11 decisions (2026-10-14)
- **Hosting (O-8, default until decided):** one Linux VM per environment (staging, production) with Docker Compose;
  images in GHCR tagged by commit SHA; GitHub Environment secrets streamed to the VM at deploy time (ADR-0011).
- **Pipeline:** a push to main builds once, deploys to staging, smoke-tests (script plus Playwright), then waits for a
  production reviewer. Rollback is a manual workflow that redeploys an earlier SHA; migrations stay forward-only and
  additive so this is safe.
- **`DEPLOY_ENV`** separates where code runs from how it is built: staging may use the mock card gateway, production
  may not. Production runs `CARD_GATEWAY=disabled` until O-7, and the web app hides card payment
  (`cardPaymentsEnabled`, API 1.11.0).
- **Configuration from files:** every variable `X` can come from `X_FILE`. Production requires `DATABASE_APP_URL`
  and `METRICS_TOKEN`; `DATABASE_URL` is needed only by the release job and backups.
- **Edge and headers:** Caddy (TLS, HSTS) in front of nginx (CSP, security headers); `/metrics` is internal only, behind
  a bearer token.
- **Backups:** daily, `age`-encrypted (private key offline with two custodians), documents through rclone crypt, in a
  separate bucket; 14 daily / 8 weekly / 12 monthly; monthly restore drill.
- **Alerts** by email from Prometheus/Alertmanager on the VM; each rule links to its RUNBOOK section.
- **Supply chain:** pinned image digests plus OS security upgrades at build; npm removed from runtime images; pnpm
  overrides lift `mysql2` and `deepmerge-ts` (pinned by Prisma 7.10.0) to fixed versions until Prisma does.
- **First admin in production:** `node dist/cli/bootstrap-admin.js` inside the API container (moved from `scripts/`).

## Phase 12 decisions (2026-10-20)
- **Authorization is proven per endpoint:** `test/int/authz-matrix.ts` maps all 122 endpoints to their SPEC §2.1 row and
  allowed roles. The integration test calls each one as every role and anonymously (guards answer 401/403; allowed roles
  pass), as a citizen and staff of another department on real records (403 or 404, and nothing changes), checks that
  lists never show another owner's or department's records, and that supervisors cannot widen reports to another
  department. A unit test keeps the map, the controllers' decorators and docs/AUTHZ_MATRIX.md in step.
- **Scope before state:** a staff action on a record checks the department as soon as the record is loaded, before any
  state rule, so a 409 or 422 never tells another department that a payment or refund exists or what state it is in
  (found in refunds by the matrix test; fixed).
- **Rate limiting cannot be switched off in production** (`DEPLOY_ENV=production` refuses `RATE_LIMIT_ENABLED=false`).
  The local stack switches it off only while the load test runs.
- **Client IP behind the proxies (fixed, was launch-blocking):** the API did not trust X-Forwarded-For, so behind
  Caddy → nginx every request had nginx's address. Audit rows recorded no real client IP, and every rate limit was
  shared by all users. `TRUST_PROXY_HOPS` (2 in the production compose file) now gives the client's address, and
  production builds refuse to start without it.
- **Rate limits follow the caller, not only the address** (carrier NAT puts many citizens on one IP): signed-in requests
  count per account, session refresh and logout per session (refresh-token family; without a cookie, as on every
  anonymous page load, only the per-IP ceiling applies), and public endpoints (sign-in,
  registration, codes, verification) and calls without a valid token per IP. A coarse per-IP ceiling on every endpoint
  (`RATE_LIMIT_PER_IP_PER_MINUTE`, 1200) bounds anyone rotating tokens. Limits are per endpoint. Residual risk: sign-in
  stays 10 a minute per IP, which a large NAT pool could hit at peak times; watch 429s on `/auth/login` after launch.
  The web app now waits for `Retry-After` and retries a throttled refresh (up to twice) instead of signing the user
  out; other refresh failures are not retried, since the token may already have rotated.
- **Submit waits for the copy count:** choosing extra copies and submitting at once could assess the fee on the old
  count (the citizen asked for copies and was charged and issued none). Submit now waits for that save and stops with
  a message if it failed (found by the e2e suite).
- **Email codes (security review, auth):** a wrong code was counted inside the transaction that then threw, so the
  count rolled back and every code could be guessed without limit (Critical; fixed: failures return out of the
  transaction and throw after commit). Codes are now also capped per address and purpose at 5 issued and 10 wrong
  guesses in 24 hours (ASVS 2.7/2.8), and wrong staff device codes count toward the account lockout. Staff and email
  changes get 429 `CODE_LIMIT`; reset and resend stay silent. API 1.12.0.
- **Auth review, Medium/Low fixes:** logout now revokes that session's access tokens at once (Redis, by session id),
  not after 15 minutes. FR-004 changed: 5 failures from one address block that address for the account, and only 20
  from any addresses lock the account, so a stranger cannot lock the owner out. A refresh token rotated in the last
  10 s may be presented once more (two tabs refreshing together) instead of revoking the family; replays after that
  still revoke it. Password reset hashes only after the code is verified. Production refuses `COOKIE_SECURE=false`.
  Accepted: the small timing difference between unknown and known accounts on a failed sign-in (argon2 dominates).
  Follow-up: alert admins when a staff account is locked (the `AUTH_LOCKED` audit row exists).
- **Code caps per address (auth re-review, 2026-10-21):** the email-code caps were per email and purpose only, so a
  stranger could use up the owner's reset or verification codes for a day (5 requests or 10 wrong guesses). They now
  count per email, purpose and client address first (5 codes, 10 wrong guesses; Redis, keyed by an HMAC so neither
  email nor address is stored), with address-wide backstops of 20 codes and 30 wrong guesses (1 in 33,000 a day). A
  stranger using many addresses can still reach the backstop; accepted, as for the FR-004 account lock. The refresh
  grace is now used once, as stated above (`refresh_token.graceUsedAt`); a third use of the same token within 10 s
  revokes the family. API 1.12.1.
- **Concurrent registrations** of the same email answer 202 like any existing account instead of a 500.
- **Launch check:** published service versions are immutable, so retired seeded test-fee versions remain in the table.
  Go-live requires that no live version has `feeIsTest = true`, that no application was assessed under one, and that no
  active test accounts exist (`dist/cli/launch-check.js`, docs/LAUNCH_CHECKLIST.md).
- **Accessibility:** axe WCAG 2.0/2.1 A and AA checks run in the Playwright suite (CI e2e job) on public, citizen, officer,
  supervisor and admin pages at 360 px and desktop. Automated checks do not replace one manual keyboard and
  screen-reader pass before launch (launch checklist §6).
- **Load test** (perf/k6) runs the NFR-006 mix against the production images on one machine: reads p95 8 ms, writes
  p95 39 ms, no failures (docs/perf/load-test.md). The numbers are indicative and must be repeated on the staging VM.
- **Public catalogue cache:** 30 s in process, cleared by every admin change to services or versions (one API container
  per VM, ADR-0011); it removed 59% of catalogue queries. A larger database pool and libuv thread pool were measured
  and did not help (bursts queue on the audit-chain lock; argon2 is CPU-bound), so they stay at their defaults;
  `DATABASE_POOL_MAX` (default 10) is configurable. If the API ever runs as several containers, the cache's 30 s
  limit is how stale another container's catalogue can be.
