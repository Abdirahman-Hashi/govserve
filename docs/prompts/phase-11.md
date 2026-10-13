# Phase 11 — Production containers, CI/CD and deployment

Implement Phase 11: deployable, cloud-ready delivery. Target: not decided yet (see docs/DECISIONS.md). Default to a single Linux VM with Docker Compose, portable to any cloud. Ask me to confirm the target before planning.

- Multi-stage Dockerfiles for api and web (web served by nginx with security headers and CSP); non-root users; pinned base images; HEALTHCHECK
- Prisma migrations run as a separate one-off job before rollout, never on app start
- docker-compose.prod.yml with secrets from the platform secret store, not files
- GitHub Actions:
  ci.yml: lint, typecheck, unit, integration, e2e (Playwright against compose), build, dependency audit, container scan (Trivy), SBOM
  deploy.yml: on main → build and push images tagged by commit SHA → deploy to staging → smoke tests; production via manual approval environment; rollback job to previous SHA
- Backups: nightly Postgres dump plus MinIO bucket and Redis (AOF) snapshots to object storage with retention, and a documented restore drill script (RPO 24 h, RTO 4 h per NFR-007)
- Observability: structured logs, /metrics (Prometheus), basic alerts (5xx rate, payment webhook failures, queue backlog, audit-chain break)
- docs/RUNBOOK.md: deploy, rollback, rotate keys (including Ed25519 signing-key rotation per ADR-0006: new ACTIVE key, old key stays published), restore backup, incident checklist

Acceptance: a fresh clone can run `make up` (or equivalent) and reach a working staging-like stack; CI is green; you have shown me the deploy workflow graph.
