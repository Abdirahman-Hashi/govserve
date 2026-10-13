# Phase 01 — Monorepo scaffold, Docker, CI skeleton

Implement Phase 1 from @docs/PROGRESS.md, following @docs/adr.

Goal: an empty but production-shaped monorepo where every quality gate already runs.

Build:
- pnpm workspaces + Turborepo: apps/api (NestJS 11, strict TS), apps/web (React 19 + Vite + TS + React Router + TanStack Query + Tailwind), packages/shared (Zod schemas, shared types, money helpers, fee calculation, status enums; no Nest/React/Prisma imports, enforced by ESLint import boundaries per ADR-0001)
- Prisma in apps/api with PostgreSQL 16; an initial baseline migration
- infra/docker-compose.yml: postgres, redis (AOF persistence), minio, mailpit (dev SMTP), clamav (virus-scan adapter for Phase 4); healthchecks on each
- Config module with Zod-validated env (fail fast on missing vars); .env.example documenting every var
- Nest: global ValidationPipe, structured JSON logging (pino) with request IDs and PII redaction, Helmet, CORS allowlist, rate limiting, /health and /ready endpoints
- Swagger at /api/docs generated from decorators; export openapi.json in CI
- Tooling: ESLint + Prettier, Jest (api), Vitest + Testing Library (web), Playwright skeleton, Testcontainers helper for integration tests
- Root scripts: dev, build, lint, typecheck, test, test:int, test:e2e
- .github/workflows/ci.yml: install, lint, typecheck, unit, integration (service containers), build

Acceptance (run and show me the output):
- `docker compose -f infra/docker-compose.yml up -d` then `pnpm dev` serves web on :5173 and api on :3000
- GET /health returns 200; /api/docs renders
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:int` all pass
- A sample shared Zod schema is imported by both api and web

Out of scope: any business feature. Update PROGRESS.md and commit.
