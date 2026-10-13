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
