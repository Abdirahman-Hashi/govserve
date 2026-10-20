# GovServe launch checklist

What remains to verify by hand before production opens to citizens. Phase 12 automated what it could: the
authorization matrix (`docs/AUTHZ_MATRIX.md`), WCAG 2.1 AA checks on key pages (`apps/web/e2e/a11y.spec.ts`), the load
test (`docs/perf/load-test.md`) and the read-only launch check below. Each item names its owner and how to confirm it.
Tick an item only when the evidence is recorded (link, screenshot or ticket).

Owner of every open item: **Abdirahman Hashi** unless stated.

## 1. Open items from SPEC §6

| # | Item | How to confirm | Done |
| --- | --- | --- | --- |
| O-1 | Official fees (base, per copy) for all three services | Admin publishes a new version per service with the official fees and "test fees" unticked; `launch-check` (§2) passes | [ ] |
| O-2 | Official validity of proof of address and police clearance | Each service's validity (Admin → Services, `validityMonths`) matches the signed-off value; one issued test certificate shows the right expiry | [ ] |
| O-3 | Official target processing times (SLA) | Each service's working-day target (Admin → Services, `slaWorkingDays`) matches; dashboard SLA figures use it | [ ] |
| O-4 | Signing office or official title per certificate | Certificate PDF template shows the approved title and wording for each service; legal approves one sample of each | [ ] |
| O-5 | Legal sign-off on retention periods and masked-name verification | Written approval of: uploads 7 years after decision, closed-application uploads 90 days, unverified accounts 7 days, audit and certificates kept indefinitely, and the public page's masked name plus full-name check (FR-092) | [ ] |
| O-6 | Working week and public holiday calendar | Holidays for the first 12 months entered under Admin → Configuration; working week matches the administration's | [ ] |
| O-7 | Card gateway choice | Until chosen, production runs `CARD_GATEWAY=disabled` (the app hides card payment). When chosen: adapter built behind `CardGatewayPort`, sandbox certification, live credentials in the production environment, webhook secret set, a real low-value payment and refund made | [ ] |
| O-8 | Hosting target | Provider and region chosen; VM per environment provisioned with an **encrypted disk** (secrets live in container layers, ADR-0011); separate backup bucket in another account or region | [ ] |
| O-9 | Accepted mobile-money wallets | The provider list in the payment form matches the official list (draft: EVC Plus, Sahal, eDahab, Jeeb, Premier Wallet, Other) | [ ] |

## 2. Data and configuration in production

- [ ] **No test fees.** On the production VM run
      `docker exec govserve-stack-api-1 node dist/cli/launch-check.js`. It fails if any live (draft or published)
      `ServiceVersion` still has `feeIsTest = true`, if any application was ever assessed under a test-fee version, or
      if active test accounts (`e2e-*`, `loadtest-*`, `@govserve.test`) exist. Published versions are immutable, so the
      seeded test-fee versions stay in the table once retired; the check lists them as notes, which is expected.
      Equivalent SQL: `SELECT s.code, v."versionNo", v.status FROM service_version v JOIN service s ON s.id = v."serviceId" WHERE v."feeIsTest";`
- [ ] **First admin** created with `node dist/cli/bootstrap-admin.js` (RUNBOOK §First-time setup), signed in from
      their own device, and a second admin invited so one person is never the only key holder.
- [ ] **Staff accounts** invited per department (Address Office, Police/CID, Civil Registry), each with at least one
      officer and **two** supervisors (birth certificates and high-value payments need a second, different supervisor).
- [ ] **Settings reviewed:** manual-payment threshold ($100.00), claim expiry, correction deadline and rounds,
      retention values (O-5).
- [ ] **No fixtures:** e2e and load-test accounts cannot be created in production (`DEPLOY_ENV=production` refuses
      both CLIs); `launch-check` confirms none exist.

## 3. Keys and secrets (RUNBOOK §Rotating keys and secrets)

Every production secret must be generated for production, stored only in the GitHub `production` environment, and
never reused from staging or a laptop.

- [ ] `PII_KEYS`: fresh 32-byte key with a key id; a copy held offline by two custodians. Losing it loses every
      national ID, phone and date of birth.
- [ ] `BLIND_INDEX_KEY`: fresh; **cannot be rotated** without the reindex job (follow-up from Phase 11), so treat it as
      long-lived and protect it like `PII_KEYS`.
- [ ] `SIGNING_KEYS`: fresh Ed25519 key; its public key appears at `/api/v1/verify/keys`. Rotation drill done once on
      staging (old receipts still verify).
- [ ] `JWT_ACCESS_SECRET`, `METRICS_TOKEN`, `CARD_WEBHOOK_SECRET`, Redis and database passwords: fresh, 32+ random
      bytes. `DATABASE_APP_URL` uses the restricted role (production refuses the owner).
- [ ] Backup `age` key pair: private half offline with two custodians, public half in `BACKUP_AGE_RECIPIENT`;
      `BACKUP_CRYPT_PASSWORD` stored with it.
- [ ] One rotation rehearsed end to end on staging (e.g. `METRICS_TOKEN`): containers recreated, old value refused.
- [ ] Nobody's personal laptop holds a production secret after setup.

## 4. Network, DNS and TLS

- [ ] DNS for the public hostname points at the production VM; `SITE_ADDRESS` and `WEB_ORIGIN` match it.
- [ ] Caddy obtained a certificate; `https://` loads, `http://` redirects, HSTS present
      (`curl -sI https://<host> | grep -i strict-transport`). Consider HSTS preload only after a month without issues.
- [ ] Security headers present on the web app (CSP, `X-Content-Type-Options`, `Referrer-Policy`, frame protection):
      check with `curl -sI` or securityheaders.com.
- [ ] **Client IPs reach the API:** on staging, sign in from a phone on mobile data and check that the newest audit row
      shows that phone's public IP, not a 172.x/10.x address (`TRUST_PROXY_HOPS=2`, Caddy → nginx). If a cloud load
      balancer is added in front of Caddy, raise it to 3 and keep Caddy's `trusted_proxies` limited to that balancer.
- [ ] Only ports 80 and 443 reachable from the internet; SSH limited to the deploy key and admin IPs; Postgres, Redis
      and `/metrics` not reachable from outside.
- [ ] Object store bucket is private, CORS limited to `WEB_ORIGIN`; a pre-signed download link expires as configured.
- [ ] SMTP: production provider chosen, SPF, DKIM and DMARC set for the sender domain; a code email reaches Gmail and
      Outlook inboxes (not spam).

## 5. Delivery and operations

- [ ] GitHub environments `staging` and `production` exist with their variables and secrets (RUNBOOK §GitHub);
      `production` has required reviewers; `main` has branch protection (PR + green CI).
- [ ] A release deployed to staging and promoted to production through `deploy.yml`; smoke test green.
- [ ] Rollback rehearsed on staging with `rollback.yml`.
- [ ] Alerts reach a monitored mailbox: trigger one test alert per rule on staging (RUNBOOK §Alerts).
- [ ] Backups: first nightly backup present in the backup bucket; restore drill passed on staging
      (`make restore-drill` equivalent, RUNBOOK §Restore) and its date recorded.
- [ ] Load test re-run against **staging** (same VM size as production) with `perf/k6/run.sh` pointed at it; p95 within
      NFR-006 (reads ≤ 500 ms, writes ≤ 1 s). The Phase 12 numbers come from a laptop and are indicative only.

## 6. Legal, content and accessibility

- [ ] Privacy notice and terms of use published and linked from the footer (data-protection sign-off, O-5).
- [ ] Public verification pages reviewed by legal: they show only type, number, status, dates and the masked name.
- [ ] Certificate and receipt wording approved (O-4); fee amounts on receipts match the official schedule (O-1).
- [ ] Manual accessibility pass: keyboard-only walk through apply → pay → status, and one screen-reader pass
      (VoiceOver or NVDA) on the wizard. Automated axe checks cover WCAG rules that can be tested by machine only.
- [ ] Support contact (phone/office) shown on error and help pages is the real one.

## 7. Security sign-off

- [ ] Phase 12 module security reviews (auth, payments, uploads, audit, the rest) completed; every Critical and High
      finding fixed, Medium and Low findings triaged with an owner (docs/DECISIONS.md, Phase 12).
- [ ] Dependency and image scans green on the release being launched (CI `images` job, `pnpm audit`).
- [ ] An external penetration test, or at least a second reviewer, before handling real payments.
