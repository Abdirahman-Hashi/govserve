# ADR 0010: Tamper-evident audit chain in the database, and a restricted application role

- Status: accepted
- Date: 2026-10-14

## Context
FR-131 requires an append-only, hash-chained audit trail with a verifier that reports the first broken link. Until Phase 10 the
API connected as the database owner, so code (or anyone with its credentials) could UPDATE or DELETE audit rows, and the
`prevHash` and `hash` columns were empty.

## Options considered
1. Hash in the application before insert: simple, but concurrent transactions could link to the same predecessor, and any
   code path that bypasses `AuditService` writes an unchained row.
2. Seal rows asynchronously in a job: no contention, but rows stay unchained for a while, and identity order is not commit
   order, so the sealer cannot know when a gap is final.
3. Hash in a `BEFORE INSERT` trigger under a transaction-scoped advisory lock: every row is chained whoever writes it, in
   commit order. The cost is that audit-writing transactions are serialised while they commit.

## Decision
Option 3, enforced by the database:
- **Chain:** `audit_chain_before_insert()` takes `pg_advisory_xact_lock`, assigns `chainSeq` from `audit_chain_seq` (lock
  order, which is commit order), and sets `prevHash` to the previous row's hash and
  `hash = sha256(prevHash ‖ audit_canonical(row))`. `audit_canonical` is `jsonb_build_object` of every column except the
  hashes, as text. Existing rows were chained once by the migration.
- **Verification:** `audit_verify()` recomputes every hash and link with window functions and returns the first problem:
  `ROW_CHANGED` or `LINK_BROKEN`. `audit_checkpoint` stores the last verified head, so rows removed from the end are reported
  as `TAIL_REMOVED`. A nightly job (and `POST /audit/verify` for admins) notifies every admin on failure.
- **Append-only:** triggers reject UPDATE, DELETE and TRUNCATE on `audit_log` and `audit_checkpoint` for everyone. On top of
  that, the API connects as a member of `govserve_app_rw`, which has INSERT and SELECT only on those tables (and normal rights
  elsewhere, through default privileges for future tables). Migrations run as the owner (`DATABASE_URL`). The API uses
  `DATABASE_APP_URL`, which production must set to a different role.

## Consequences
- Tampering needs superuser plus deliberately disabling triggers (`session_replication_role = replica`), and the verifier
  still reports it. The integration tests simulate exactly that.
- Integration tests run as the restricted role, so code that tries to change audit rows fails CI.
- Deployment (Phase 11) must create the login role from the secret store and `GRANT govserve_app_rw` to it before the API
  starts. In development, `pnpm --filter api db:app-role` does this.
- Audit writes are serialised: fine at pilot volume. If it ever matters, the chain could be partitioned per day with a
  daily anchor, keeping the same verifier contract.
