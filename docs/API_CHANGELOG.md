# API changelog

The API is served under `/api/v1`. `info.version` in the OpenAPI document is the contract version: a change to any path,
schema, example, role statement or error response needs a version bump and a note here. Then record it with
`pnpm --filter api openapi:lock`; the contract test (`src/openapi-contract.spec.ts`) fails until you do.

## 1.11.0 (2026-10-14, Phase 11)
- `ApplicationDetail.cardPaymentsEnabled`: false when no card gateway is configured (production until O-7). Starting a
  card payment then returns 409 `CARD_UNAVAILABLE`.
- `GET /metrics` (Prometheus, outside `/api/v1`, bearer `METRICS_TOKEN`) is excluded from this document.

## 1.10.0 (2026-10-14, Phase 10)
- Every operation documents its auth (`security`, with explicit `[]` for public operations), roles, examples for each JSON
  request, response and parameter, and its error codes using the shared `ErrorEnvelope` schema. Standard 401, 422, 429 and
  500 responses added where they apply.
- Query filters validated as a whole (`/applications`, `/payments`, `/reports/*`, `/audit`) are now listed as parameters.
- New: `GET /audit`, `GET /audit/applications/{id}`, `GET /audit/export.csv` (SUPERVISOR, ADMIN) and `POST /audit/verify`
  (ADMIN).
- `Document` gains `purged` (the file was deleted under the retention policy). Downloading it returns 410 `DOCUMENT_PURGED`.
- Notifications: new `AUDIT_CHAIN_BROKEN` template for admins.

## 1.9.0 (Phase 09)
- `GET /reports/*` dashboard endpoints and CSV exports (SUPERVISOR, ADMIN).

## 1.8.0 (Phase 08)
- `GET /applications` returns keyset pages; `GET /payments` added; staff search and CSV export (POST).

## 1.7.0 (Phase 07)
- In-app notifications and email preferences.

## 1.0.0–1.6.0 (Phases 01–06)
- Authentication, catalogue, applications and documents, payments and receipts, review and certificates.
