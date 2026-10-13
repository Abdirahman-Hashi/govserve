# Phase 05 — Fee assessment, payments and verifiable receipts

Implement Phase 5: fees, payments and receipts. This is financial code: correctness over speed. Plan in detail and wait for approval.

Fee assessment:
- The FeeAssessment created at submit (Phase 4) is immutable: line items, total cents, rule snapshot. No adjustments, waivers or overrides exist (FR-041).

Payments:
- Payment, PaymentEvent (append-only), Refund, Receipt, Counter per @docs/DATA_MODEL.md §4; statuses and transitions exactly as @docs/STATE_MACHINES.md §2 (payment, including AWAITING_SUPERVISOR) and §3 (refund), all through PaymentStateService / RefundService
- Channels per @docs/DECISIONS.md, all amounts USD in cents:
  - Mobile money and bank: citizen submits transaction ID / deposit-slip number + optional screenshot or slip photo → PENDING_VERIFICATION in an officer verification queue → officer confirms or rejects with a reason. Duplicate transaction IDs rejected.
  - Cash: officer records it at the counter with the receipt-book reference.
  - Manual payments (including cash) with amount > `payment.supervisorThresholdCents` (default 10000 = $100.00) go to AWAITING_SUPERVISOR after the first confirmation; a supervisor other than the first confirmer must confirm.
  - Duplicate (channel, provider, reference) among non-REJECTED payments → 409.
  - Card: CardGateway port with MockCardGateway (real gateway TBD). Card payments are confirmed only by the signed gateway webhook, never by an officer.
- Keep a PaymentProvider port so an automatic mobile-money API can be added later
- Idempotency-Key header on initiate; webhook endpoint verifies HMAC signature, timestamp tolerance, and is idempotent on providerRef; reconciliation job polls pending card payments
- Partial payments accumulate; when confirmed total ≥ assessment the application moves AWAITING_PAYMENT → QUEUED (A5) in the same transaction; excess is recorded as overpaidCents. No float arithmetic anywhere
- Refunds only for WITHDRAWN_BEFORE_REVIEW, DUPLICATE_PAYMENT, OVERPAYMENT, ABANDONED_UNPAID; supervisor approves; card refunds via the gateway. No refund on rejection/referral
- Card chargeback webhook → REVERSED (P9) and sets the application's chargebackFlag; no automatic revocation
- Job: applications unpaid 30 days after submit → ABANDONED (A7)

Receipts:
- On CONFIRMED: generate a receipt number (gap-free per fiscal year, via a locked counter row), PDF (pdfkit or Playwright print) with QR code
- SigningService per ADR-0006 (JCS canonical payload, Ed25519, keyId, published public keys); QR encodes /verify/r/{receiptNo}#sig=… (signature in the fragment, never in server logs)
- Public verification page shows only: receipt no, service, amount, date, status VALID/REFUNDED/REVERSED (or signature INVALID); no PII

Tests:
- Fee engine property tests; two officers confirming the same payment → one confirmation; duplicate transaction ID rejected; officer cannot confirm a card payment; amount > threshold needs a second, different supervisor; partial payments queue the application only when fully paid; refund total cannot exceed the payment; double webhook delivery creates one payment; bad signature rejected; concurrent confirmations produce one receipt number; tampered receipt fails verification
- Integration: submit → assess → mobile-money evidence → officer confirms → receipt download → public verify; and the same with mock card → webhook

Show me the payment state diagram and test output before committing.
