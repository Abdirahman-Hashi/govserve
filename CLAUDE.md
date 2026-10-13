# GovServe — Revenue & Service Portal
Government portal for individual citizens: apply online for proof of address, police clearance and birth
certificates, pay, and download signed, QR-verifiable certificates; officers review via work queues.
Services: @docs/SERVICES.md. Full spec: @docs/SPEC.md. Settled decisions: @docs/DECISIONS.md. Progress: @docs/PROGRESS.md

## Stack
pnpm + Turborepo monorepo · apps/api NestJS 11 + Prisma + PostgreSQL 16 · apps/web React 19 + TS + Vite
· packages/shared Zod schemas · Redis + BullMQ (jobs) · S3-compatible storage (MinIO locally)

## Commands
- Start deps: `docker compose -f infra/docker-compose.yml up -d`
- Dev: `pnpm dev` · Lint: `pnpm lint` · Types: `pnpm typecheck`
- Tests: `pnpm test` (unit) · `pnpm test:int` (API + Testcontainers) · `pnpm test:e2e` (Playwright)
- DB: `pnpm --filter api prisma migrate dev --name <name>`

## Non-negotiables
- Money is USD in integer cents (BigInt). Never floats.
- Every status change, payment event and admin action writes an AuditLog row in the SAME transaction.
- Authorization is enforced server-side with guards; the UI hiding a button is not security.
- Validate all input with Zod/class-validator at the API edge; never trust client-computed fees.
- PII fields (national ID, phone, DOB) are encrypted at rest via the crypto service.
- No secrets in code or logs. Never read or print .env files.

## Workflow
- Work one phase at a time from docs/prompts. Plan first, wait for approval, then implement.
- Never spawn subagents. Explore narrowly: grep, then read only the files you need. Run only relevant tests while iterating.
- Done = lint + typecheck + tests green, OpenAPI updated, PROGRESS.md ticked.
- Small commits, conventional messages (feat:, fix:, test:, chore:).
- Record any architecture decision as an ADR in docs/adr.
- When compacting, keep: current phase, files changed, failing tests, open decisions.
