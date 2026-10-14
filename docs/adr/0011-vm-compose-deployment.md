# ADR 0011: One VM per environment with Docker Compose, secrets from GitHub Environments

- Status: accepted
- Date: 2026-10-14

## Context
Phase 11 needs a deployable, cloud-portable stack (NFR-007: RPO 24 h, RTO 4 h) while the hosting target (O-8) is still
open and the expected load is one regional administration's citizens and staff. The stack is an API with in-process
BullMQ workers, a static web app, PostgreSQL 16, Redis, ClamAV and an S3-compatible store. Secrets must come from a
secret store, never from files in the repository or on the server. The card gateway (O-7) is not chosen.

## Options considered
1. **One Linux VM per environment running Docker Compose**: portable to any provider, one person can operate it, and
   it is the same compose file that CI and developers run (`make up`). No automatic failover; a deploy briefly
   interrupts requests while the API container is replaced.
2. **Managed containers (ECS/Cloud Run/Container Apps)**: zero-downtime rollouts and managed scaling, but ties the
   deployment to one cloud before O-8 is decided, and needs managed Postgres and Redis to be useful.
3. **Kubernetes**: most flexible, far more to operate than the load needs.

For secrets: (a) env files on the VM, (b) a cloud secret manager, (c) GitHub Environment secrets streamed to the VM at
deploy time and handed to Compose as `secrets: { environment: … }`.

## Decision
Option 1 with secrets (c). GHCR holds images tagged by commit SHA, built once and promoted from staging to production
behind a required-reviewer environment. Specifically:
- **Edge:** Caddy terminates TLS (automatic certificates, HSTS) and proxies to nginx, which serves the web app with the
  CSP and proxies `/api`. `/metrics` is never routed publicly; Prometheus scrapes it on the internal network with a
  bearer token.
- **Secrets:** `deploy.sh` streams them over SSH stdin into the remote shell only. Compose copies each into its
  container as `/run/secrets/<name>`, and the API reads `X_FILE` for every secret `X`. They never reach the release
  directory, an env file, a command line or `docker inspect`, but they do live in the container's layer under the
  root-only `/var/lib/docker` while it exists, so the VM disk must be encrypted. Because Compose ignores a changed
  secret value, every service that mounts secrets carries a label with a digest of all secret values, so a rotation
  recreates exactly those containers.
- **Release job:** migrations, the application login role and reference data run in a separate `migrate` image
  before rollout, never on API start. Migrations are forward-only and additive, so a rollback redeploys older images
  over the newer schema.
- **`DEPLOY_ENV`** (`local`, `staging`, `production`) is separate from `NODE_ENV`: staging runs production builds with
  test adapters; only `DEPLOY_ENV=production` refuses the mock card gateway and the e2e staff fixture.
- **Card payments:** `CARD_GATEWAY=disabled` in production until O-7. Card checkout answers 409 `CARD_UNAVAILABLE`, and
  the application detail carries `cardPaymentsEnabled` so the web app hides the option.
- **Workers** stay in the API process (one container to scale and monitor); splitting them out is a compose change.
- **Backups:** a `backup` container dumps Postgres and snapshots Redis daily, encrypts both with `age` to a public key
  whose private half is kept offline, copies documents through an rclone crypt remote, and keeps 14 daily, 8 weekly and
  12 monthly copies in a separate bucket. A restore drill verifies checksums, row counts, `audit_verify()`, the Redis
  queues and the document count.
- **Monitoring:** Prometheus and Alertmanager on the same VM, alerting by email; rules for API down, 5xx rate, webhook
  failures, queue backlog, dead-lettered email and a broken audit chain.
- **Supply chain:** base images pinned by digest and upgraded with distribution security fixes at build; actions pinned
  by commit SHA; Trivy fails CI on fixable HIGH or CRITICAL findings and produces a CycloneDX SBOM per image.

## Consequences
- Any provider with a Linux VM and an S3-compatible bucket works; moving providers is DNS, a restore and a new
  `SSH_HOST`.
- A single VM is a single point of failure: recovery is a restore within the 4-hour RTO, not failover. Revisit if
  availability targets tighten or load outgrows one machine (Postgres and Redis can move to managed services by
  changing two URLs).
- GitHub is part of the trust boundary: anyone who can approve the production environment or edit its secrets can
  deploy. Keep the reviewer list short and branch protection on.
- Postgres reads its password only when first initialised; the runbook covers changing the owner password.
- Scanner findings in base images arrive continuously; a red `images` job means rebuild (and bump pins) rather than
  ignore.
