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
