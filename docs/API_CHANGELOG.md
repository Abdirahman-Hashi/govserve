# API changelog

The API is served under `/api/v1`. `info.version` in the OpenAPI document is the contract version: a change to any path,
schema, example, role statement or error response needs a version bump and a note here. Then record it with
`pnpm --filter api openapi:lock`; the contract test (`src/openapi-contract.spec.ts`) fails until you do.

## 1.12.1 (2026-10-21, Phase 12)
- Email code caps now count per client address first: 5 codes and 10 wrong guesses a day per email, purpose and
  address, with 20 codes and 30 wrong guesses from all addresses as the backstop. A stranger can no longer use up the
  owner's reset or verification codes for the day. The 429 `CODE_LIMIT` descriptions say so.
- `POST /auth/refresh`: the 10-second grace for a just-rotated token is used once; a further replay revokes the session.

## 1.12.0 (2026-10-20, Phase 12)
- Email codes are capped per address and purpose: 5 codes and 10 wrong guesses in 24 hours. Beyond that, codes are
  refused as `CODE_TOO_MANY_ATTEMPTS`; password reset and resend still answer 202 but send nothing.
- `POST /auth/login` (staff on a new device) and `POST /users/me/email` can return 429 `CODE_LIMIT` once 5 codes were
  sent that day. Wrong staff device codes now count toward the account lockout.
- Rate limits are counted per account for signed-in calls and per session for refresh and logout; public auth
  endpoints stay per IP.
- Sign-in lockout (FR-004): 5 failures from one address block that address for the account; 20 from anywhere lock
  the account. Responses are unchanged (401 `INVALID_CREDENTIALS`).
- `POST /auth/logout` invalidates that session's access tokens at once. `POST /auth/refresh` accepts a token rotated
  in the last 10 seconds once more (concurrent tabs) instead of treating it as reuse.

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
