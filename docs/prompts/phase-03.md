# Phase 03 — Service catalogue and configurable forms

Implement Phase 3: the configurable service catalogue. Plan first.

Model:
- ServiceCategory, Service (code, name, description, department, active, SLA days)
- ServiceVersion: immutable once published; holds formSchema (JSON Schema), uiSchema, requiredDocuments (type, mime types, max size, required?), feeRule (see below)
- Applications always reference the ServiceVersion they were submitted against

Fee rule DSL (stored as JSON, evaluated server-side only, in packages/shared so the UI can preview):
- flat, per-unit (field × rate), tiered brackets, minimum/maximum, late penalty by days, exemptions by flag
- USD only, integer cents; deterministic rounding; full unit-test table for each rule type

Admin UI:
- CRUD for categories and services; version editor for form fields (text, number, date, select, checkbox, file), required docs and fee rule; live form + fee preview; publish/retire versions
- Validation: a version cannot publish if the schema or fee rule is invalid

Citizen UI:
- Browse/search catalogue, service detail page (requirements, fee estimate, SLA)
- Dynamic form renderer from formSchema with client + server validation (same schema)

Audit: create/publish/retire of services and versions.

Acceptance:
- Seed the three pilot services from docs/SERVICES.md (proof of address, police clearance, birth certificate) with their confirmed form fields, documents and fee rules (USD)
- Integration test: publishing then editing creates a new version; old version unchanged
- Fee engine tests cover every rule type and edge (zero, max cap, penalty boundary)
