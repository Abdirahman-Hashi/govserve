# ADR 0002: Prisma as ORM on PostgreSQL 16

- Status: accepted
- Date: 2026-10-13

## Context
Transactional data (applications, payments, audit) needs strong typing, reviewable migrations and multi-row
transactions in which the AuditLog write commits together with the state change. Some features need raw SQL:
partial unique indexes, trigram/tsvector search, `SELECT … FOR UPDATE` counters, and DB role grants for append-only audit.

## Options considered
1. Prisma: generated types, a clear migration workflow, interactive `$transaction`, good NestJS fit. Partial indexes, triggers
   and grants need hand-edited SQL migrations, and its bigint and JSON ergonomics need helpers.
2. TypeORM: decorators fit Nest, but its type safety is weaker and its migrations less reliable.
3. Drizzle / Kysely: SQL-first and very typed, but a younger ecosystem, and less familiar to the team.

## Decision
Prisma with PostgreSQL 16. Partial unique indexes, GIN/trigram indexes, check constraints, triggers and audit grants
go in SQL appended to the generated migrations. Raw SQL (`$queryRaw` with tagged templates only) is allowed for search,
counters and reports. Money uses `BigInt`. Optimistic locking uses a `version` column with `updateMany where version`.

## Consequences
- Strong types end to end. Migrations are one per change and never edited after merge.
- Developers must remember the SQL-only constraints in migration review. Integration tests (Testcontainers) cover them.
- Status writes go through state services, never ad-hoc `update({status})`. This is enforced by review and a lint rule.
