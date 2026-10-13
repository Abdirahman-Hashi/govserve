# Phase 08 — Search and history

Implement Phase 8: searchable application and transaction history. Plan first.

- Citizens: their applications, payments and receipts with filters (status, service, date range) and text search on reference number
- Officers/supervisors: search across their scope by reference no, receipt no, applicant name, national ID (via the blind index, never decrypting in SQL), phone, date range, status, channel, amount range
- PostgreSQL full-text search (tsvector + GIN) for names/descriptions; trigram index for partial reference numbers; keyset pagination (no OFFSET on large tables)
- CSV export for supervisors (streamed, row cap, audited as an export event)
- Every search endpoint enforces the same scope guards as detail endpoints

Tests: scope leakage tests (officer of dept A cannot find dept B records); pagination stability; EXPLAIN ANALYZE on 100k seeded rows shows index use — include the plans in the PR description.
