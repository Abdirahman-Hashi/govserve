# Phase 10 — Audit trail hardening and API documentation

Implement Phase 10: make the audit trail tamper-evident and finish the API docs. Run in manual permission mode.

Audit:
- Review every module: list each state change, payment event and admin action and confirm it writes AuditLog in the same transaction. Produce a coverage table; fix gaps.
- AuditLog fields per @docs/DATA_MODEL.md §6: id, occurredAt, actorId, actorRole, actorType (USER/SYSTEM/PUBLIC), action, entityType, entityId, departmentId, before/after (PII redacted), ip, userAgent, requestId, prevHash, hash
- Hash chain: hash = SHA-256(prevHash + canonical JSON of row); verification job reports the first broken link
- Database: app role has INSERT/SELECT only on audit_log (no UPDATE/DELETE), enforced in a migration
- Audit viewer (SUPERVISOR for own department, ADMIN for all; read-only): filter by entity, actor, action, date; view the full history of one application; export

Retention (FR-150–152, @docs/DATA_MODEL.md §8):
- Nightly jobs: delete document objects 7 years after decision (keep row, set purgedAt); purge WITHDRAWN/ABANDONED uploads after 90 days; purge unverified accounts after 7 days; prune expired OTPs/refresh tokens and dispatched outbox rows after 30 days
- Every purge writes an audit entry; certificates, receipts, payments and audit are never deleted

API docs:
- Every endpoint has summary, auth requirement, roles, request/response schemas with examples, error codes
- URI versioning /api/v1; consistent error envelope { error: { code, message, details, requestId } }
- Publish openapi.json as a CI artifact; add a contract test that fails if the spec changes without a version note

Acceptance: tamper test (manually UPDATE a row in a test DB as superuser) is detected by the verifier; audit coverage table shows 100% of the listed actions.
