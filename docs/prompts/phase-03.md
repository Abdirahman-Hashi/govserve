# Phase 03 — Service catalogue and configurable forms

Implement Phase 3: the configurable service catalogue. Plan first.

Model:
- Service (code, name, description, department, active, SLA working days, inPersonStep NONE/FINGERPRINTS/APPEARANCE, approvalMode SINGLE/SUPERVISOR_SECOND/SUPERVISOR_ON_RECORD_FOUND, validityMonths or none, certificatePrefix, subjectMode SELF/SELF_OR_CHILD) per @docs/DATA_MODEL.md §2. No categories (three services)
- ServiceVersion: immutable once published; holds formSchema (JSON Schema, PII fields tagged `x-pii`), uiSchema, requiredDocuments (type, mime types, max size, required?, oneOfGroup for "any one of"), fee rule (see below), feeIsTest flag
- Setting (payment threshold, correction deadline/rounds, claim expiry, retention, etc.), Holiday, ReasonCode tables with admin CRUD; all changes audited with before/after
- Applications always reference the ServiceVersion they were submitted against

Fee rule (FR-040–042; no waivers, penalties, express fees, tiers or overrides at launch):
- `feeBaseCents + feePerCopyCents × extraCopies` (extraCopies 0–5); duplicate certificate = `feePerCopyCents × copies` (min 1)
- Pure function in packages/shared so the UI can preview; the server is the only source of an assessed amount
- USD only, bigint cents; full unit-test table (zero fee, 0 and 5 copies, duplicate)

Admin UI:
- CRUD for services; version editor for form fields (text, number, date, select, checkbox, file), required docs and fee rule; live form + fee preview; publish/retire versions; a visible TEST badge while feeIsTest is true
- Validation: a version cannot publish if the schema or fee rule is invalid; at most one PUBLISHED version per service

Citizen UI:
- Browse/search catalogue, service detail page (requirements, fee estimate, SLA)
- Dynamic form renderer from formSchema with client + server validation (same schema)

Audit: create/publish/retire of services and versions; settings, holidays and reason-code changes.

Acceptance:
- Seed the three pilot services from docs/SERVICES.md (proof of address, police clearance, birth certificate) with their confirmed form fields, documents, in-person step and approval mode; fees are the TEST values from SERVICES.md with feeIsTest = true (official amounts are open item O-1)
- Integration test: publishing then editing creates a new version; old version unchanged
- Fee tests assert exact cents for base only, base + copies, max copies, duplicate, and reject copies outside 0–5
