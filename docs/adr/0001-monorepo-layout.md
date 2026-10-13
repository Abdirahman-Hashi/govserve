# ADR 0001: Monorepo layout with pnpm workspaces and Turborepo

- Status: accepted
- Date: 2026-10-13

## Context
GovServe has a NestJS API, a React web app and shared validation logic. The API (server-side, authoritative) and the
web app (preview) must use the same Zod schemas, money helpers and fee calculation, so the two cannot drift. One developer plus
Claude Code works on it, and CI must stay fast.

## Options considered
1. Polyrepo (api, web, shared published to a registry): clear boundaries, but versioning overhead and slow cross-cutting changes.
2. Monorepo with npm/yarn workspaces only: simple, but no task caching or dependency-aware pipelines.
3. Monorepo with pnpm workspaces and Turborepo: strict dependency isolation, fast installs, cached and ordered `lint/typecheck/test/build`.
4. Nx: powerful, but heavier configuration and generators we don't need.

## Decision
Option 3. Layout:
```
apps/api          NestJS 11 + Prisma (one module per bounded context)
apps/web          React 19 + Vite + TS
packages/shared   Zod schemas, DTO types, money (bigint cents) helpers, fee calculation, state enums
infra/            docker-compose (postgres, redis, S3-compatible objectstore, mailpit, clamav)
docs/             spec, data model, state machines, ADRs, prompts
```
`packages/shared` has no runtime dependencies on Nest or React. Root scripts (`dev, lint, typecheck, test, test:int,
test:e2e, build`) delegate to Turborepo.

## Consequences
- A change to a shared schema or fee rule is one commit, and it is type-checked in both apps.
- Turborepo caching keeps CI fast. Remote cache is optional later.
- We must keep shared free of server-only code (secrets, Prisma) and enforce this with ESLint import boundaries.
