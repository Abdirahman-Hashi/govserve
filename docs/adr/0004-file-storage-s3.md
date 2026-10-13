# ADR 0004: S3-compatible object storage with pre-signed URLs

- Status: accepted (local store amended by ADR-0007)
- Date: 2026-10-13

## Context
Citizens upload ID scans, letters and payment slips (≤5 MB, PDF/JPEG/PNG), sometimes over slow mobile links. We
generate certificate and receipt PDFs. Files are sensitive, must be private, must be virus-scanned, and must be deletable for
retention. The hosting target is not decided, so storage must be portable.

## Options considered
1. Store files in PostgreSQL (bytea): simple backups, but bloats the DB and makes streaming poor.
2. Local filesystem on the VM: simple, but not portable to multi-instance setups, and no signed URLs.
3. S3-compatible object storage (MinIO locally and on a VM, any cloud S3 later) with pre-signed PUT/GET.

## Decision
Option 3. Private bucket(s) with no public ACLs. Uploads use a pre-signed PUT (5 min, exact content-length and type) after
the API creates a `Document` row with an opaque key. The API then verifies size, magic-byte MIME and SHA-256, and marks
the file QUARANTINED until the virus-scan port (ClamAV adapter) marks it CLEAN. Downloads use pre-signed GETs (60 s) issued
only after an ownership or department check, each one audited for staff. Generated PDFs live under `certs/` and `receipts/`.
Server-side encryption is enabled where the backend supports it.

## Consequences
- Large payloads bypass the API, which suits low-bandwidth uploads and keeps the API light.
- Integrity relies on post-upload verification, so a document is unusable until verified and clean.
- Backups must include the bucket, and the retention jobs must delete objects as well as mark rows.
