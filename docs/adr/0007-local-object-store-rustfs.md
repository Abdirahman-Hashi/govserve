# ADR 0007: RustFS as the local S3-compatible object store (amends ADR-0004)

- Status: accepted
- Date: 2026-10-13

## Context
ADR-0004 chose S3-compatible storage with "MinIO locally and on a VM". During Phase 01 the MinIO images
(`minio/minio`, `minio/mc`) could no longer be pulled from Docker Hub, and the Quay mirror requires authentication.
The application only speaks the S3 API (pre-signed PUT/GET, path-style addressing), so the store behind it is
replaceable.

## Options considered
1. MinIO from an authenticated registry: same product, but every developer and CI runner needs registry credentials.
2. RustFS (`rustfs/rustfs`, Apache-2.0): a single-container S3-compatible server positioned as a MinIO drop-in. It is a young project.
3. SeaweedFS: mature, but runs as several components with S3 as one gateway, which is heavier for a single VM.

## Decision
Use RustFS (`rustfs/rustfs:1.0.1`, path-style addressing) as the `objectstore` service in `infra/docker-compose.yml`
for development and as the default single-VM store. The bucket is created by a one-shot `amazon/aws-cli` container.
Application code depends only on the S3 API through the storage port (ADR-0004), with `S3_ENDPOINT` and
`S3_FORCE_PATH_STYLE` as configuration, so any S3 store (cloud S3, MinIO, SeaweedFS) can replace it without code changes.

## Consequences
- No registry credentials are needed, and the stack starts with `docker compose up -d`.
- RustFS is young. Phase 04 integration tests must cover the S3 operations we rely on (pre-signed PUT/GET,
  HEAD, DELETE), and the production store is re-confirmed with the hosting target before Phase 11.
- Docs that said "MinIO" now say "S3-compatible store (RustFS locally)".
