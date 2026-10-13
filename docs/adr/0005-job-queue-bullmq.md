# ADR 0005: BullMQ on Redis for background jobs, fed by a transactional outbox

- Status: accepted
- Date: 2026-10-13

## Context
Many effects must happen after a committed state change and must survive crashes: emails, PDF rendering, virus scans,
card reconciliation, claim expiry, correction deadlines, retention purges, report refreshes and audit-chain verification.
Effects must not fire for rolled-back transactions and must not run twice.

## Options considered
1. In-process events / setTimeout: lost on restart, and no retries.
2. Postgres-only queue (pg-boss / graphile-worker): one less dependency, but less tooling for delays, rate limits and dashboards.
3. BullMQ on Redis with a transactional outbox table: a mature Node queue with retries, backoff, delayed and repeatable jobs and
   DLQ handling. The outbox guarantees that only committed events are enqueued.

## Decision
Option 3. State services write an `OutboxEvent` row in the same transaction as the state change and the AuditLog. A relay
worker reads undelivered outbox rows (`FOR UPDATE SKIP LOCKED`), enqueues BullMQ jobs with a `jobId` derived from the
event id (dedup), and marks them dispatched. Workers are idempotent: notifications are unique per event, channel and recipient, and PDF
rendering is keyed by certificate or receipt id. Scheduled work uses BullMQ repeatable jobs. Failed jobs retry with
exponential backoff and then move to a dead-letter queue with an alert.

## Consequences
- At-least-once delivery with idempotent handlers gives effectively-once effects.
- Redis becomes a required dependency. It needs persistence (AOF) and is included in backups and health checks.
- The outbox table needs periodic pruning of dispatched rows (keep 30 days).
