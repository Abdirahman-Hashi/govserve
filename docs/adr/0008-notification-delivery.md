# ADR 0008: Notification delivery: outbox relay, BullMQ jobs, direct sends for secrets (extends ADR-0005)

- Status: accepted
- Date: 2026-10-14

## Context
FR-100–FR-102 require email for every lifecycle event, idempotent per event, channel and recipient, with retries,
a dead-letter queue and user opt-out for non-transactional messages. Since Phase 04, every state change writes an
OutboxEvent in its own transaction (IDs and statuses only). Verification codes, device codes and invitation links
are one-time secrets, and the user is waiting on screen for them.

## Options considered
1. Everything through the outbox: one path, but codes and links would be stored in the database and in Redis job
   data until delivered, and a slow queue would leave users waiting for codes.
2. Send from the request after commit: simple, but a crash or SMTP outage loses messages and there is no retry
   or dead-letter.
3. Outbox relay for events, direct send for secrets: events get durability and retries; secrets are never
   persisted beyond their hash.

## Decision
Option 3.
- A repeatable BullMQ job (every `OUTBOX_POLL_MS`) claims undispatched events with `FOR UPDATE SKIP LOCKED`. A pure
  planner maps each event to (template, recipients, mandatory). The relay writes one `Notification` row per
  recipient, unique on (eventId, channel, userId), and marks the event dispatched in the same transaction.
  Delivery jobs are enqueued after commit, with the row id as job id. A sweeper re-enqueues rows left QUEUED.
- The delivery worker skips rows already SENT, so replays and duplicate jobs never resend. It retries with
  exponential backoff (`NOTIFY_ATTEMPTS`, `NOTIFY_BACKOFF_MS`). SMTP 5xx or envelope errors fail at once.
  After the last attempt the row is DEAD and a copy goes to `notifications-dead`.
- Codes and invitations go through `DirectNotifier`. It sends synchronously and logs a row with the template and
  outcome only (no event, no variables).
- Templates are channel-neutral, keyed by name and non-PII variables. The `NotificationPort` stays
  channel-agnostic, so an SMS adapter can be added without touching callers.

## Consequences
- Emails arrive within a few seconds of the change, not instantly. The in-app list is the source of truth.
- Opt-out applies only to the three optional templates. Skipped rows are kept (status SKIPPED) and shown in the app.
- Dead-lettered messages need an operator view or alert (Phase 10/11).
- Events written before the relay existed were marked dispatched by the migration, so they are not emailed.
