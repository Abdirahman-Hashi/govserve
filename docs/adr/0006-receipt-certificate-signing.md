# ADR 0006: Ed25519 signing of receipts and certificates with public QR verification

- Status: accepted
- Date: 2026-10-13

## Context
Every receipt and certificate must be verifiable by any third party (an employer, bank or embassy) by scanning a QR code,
including offline checks of a printed copy against our public key. Verification must expose no PII beyond a masked name,
must reflect revocation, and must survive key rotation.

## Options considered
1. Random unguessable URL token only: simple, but the PDF itself cannot be proven authentic.
2. PDF digital signatures (PAdES with an X.509 CA): the strongest legal standing, but needs a PKI and certificate authority that the
   authority does not have yet.
3. Ed25519 signature over a canonical JSON payload, embedded in the QR and stored server-side: small, fast, and verifiable
   online or with the published public key.

## Decision
Option 3, upgradable to PAdES later.
- Payload (canonical JSON, RFC 8785 JCS): `{t: "CERT"|"RCPT", no, svc, iss (issuedAt), exp?, h (masked holder name),
  amt? (receipts, cents string), kid}`. There is no ID number, address or parents in the payload.
- Signature: Ed25519 over the canonical bytes, using the key `kid` from the secret store. Public keys are published at
  `/api/v1/verify/keys` and stored in `SigningKey`.
- QR encodes `https://<host>/verify/c/{no}#sig={base64url}` (receipts: `/verify/r/{no}`). The fragment keeps the signature
  out of server logs. The page validates the signature client-side against the published key and fetches live status
  (VALID / EXPIRED / REVOKED; receipts VALID / REFUNDED / REVERSED) from the API.
- Rotation: a new ACTIVE key signs new documents. Retired keys stay published so old documents still verify.
- Name check: `POST /api/v1/verify/c/{no}/name-check` returns `{match: bool}` only, rate-limited and audited as PUBLIC.

## Consequences
- Tampered PDFs or payloads fail verification. Revocation is live because status always comes from the server.
- Private-key custody is critical: it is held in the secret store only, never in the DB or logs, and rotation is documented in the RUNBOOK.
- The legal weight of an Ed25519-signed PDF needs the authority's acceptance (open item O-5).
