# Phase 07 — Email notifications

Implement Phase 7: notifications. Plan first.

- Listen to domain events (submitted, correction requested, approved, rejected, payment confirmed, receipt issued, SLA breach for officers)
- NotificationPort with an EmailAdapter only (SMTP provider TBD; Mailpit in dev). Keep the port channel-agnostic so SMS can be added later without touching callers
- Templates in English with variables, HTML + plain-text versions
- Delivered via BullMQ jobs: retries with exponential backoff, dead-letter queue, idempotency per event+channel+recipient
- User notification preferences; mandatory messages (verification codes, receipts) ignore opt-out
- Notification log table and an in-app notifications list with unread badge
- Emails contain no PII beyond first name and reference number; link to the portal for details

Tests: events enqueue the right jobs; retry then dead-letter on permanent failure; no duplicate send on event replay; template rendering (HTML + text).
