# Phase 05 — Fee assessment, payments and verifiable receipts

Implement Phase 5: fees, payments and receipts. This is financial code: correctness over speed. Plan in detail and wait for approval.

Fee assessment:
- On submit, compute an Assessment from the ServiceVersion fee rule (server-side only), storing line items, total in minor units, currency, rule snapshot and due date
- Adjustments/waivers require a reason and the SUPERVISOR role; original and adjusted values both kept; audited

Payments:
- Payment (assessment, amount, channel, providerRef, status: INITIATED/PENDING_VERIFICATION/CONFIRMED/REJECTED/FAILED/REVERSED), PaymentEvent (append-only)
- Channels per @docs/DECISIONS.md, all amounts USD in cents:
  - Mobile money and bank: citizen submits transaction ID / deposit-slip number + optional screenshot or slip photo → PENDING_VERIFICATION in an officer verification queue → officer confirms or rejects with a reason. Duplicate transaction IDs rejected.
  - Cash: officer records it at the counter with the receipt-book reference.
  - Above the USD threshold from SPEC.md, a supervisor must also confirm manual payments.
  - Card: CardGateway port with MockCardGateway (real gateway TBD). Card payments are confirmed only by the signed gateway webhook, never by an officer.
- Keep a PaymentProvider port so an automatic mobile-money API can be added later
- Idempotency-Key header on initiate; webhook endpoint verifies HMAC signature, timestamp tolerance, and is idempotent on providerRef; reconciliation job polls pending card payments
- Partial payments and overpayments handled per spec; no float arithmetic anywhere

Receipts:
- On CONFIRMED: generate a receipt number (gap-free per fiscal year, via a locked counter row), PDF (pdfkit or Playwright print) with QR code
- Sign the canonical receipt payload with Ed25519; QR encodes /verify/{receiptNo}?sig=…
- Public verification page shows only: receipt no, service, amount, date, status, VALID/INVALID; no PII

Tests:
- Fee engine property tests; two officers confirming the same payment → one confirmation; duplicate transaction ID rejected; officer cannot confirm a card payment; double webhook delivery creates one payment; bad signature rejected; concurrent confirmations produce one receipt number; tampered receipt fails verification
- Integration: submit → assess → mobile-money evidence → officer confirms → receipt download → public verify; and the same with mock card → webhook

Show me the payment state diagram and test output before committing.
