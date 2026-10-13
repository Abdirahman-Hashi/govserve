# ADR 0003: JWT access tokens with rotating refresh tokens; email OTP for staff devices

- Status: accepted
- Date: 2026-10-13

## Context
Citizens and staff use the same API from a browser SPA on mobile networks. We need stateless authorization on each request,
the ability to revoke sessions (deactivation, password reset), protection against stolen refresh tokens, and a
second factor for staff that works without smartphones (DECISIONS: email is required; Phase 0: staff email OTP).

## Options considered
1. Server-side sessions (cookie + Redis): simple revocation, but every request reads the store and the API is less portable.
2. JWT access (15 min) + rotating opaque refresh token in an httpOnly cookie, with reuse detection: stateless hot path,
   revocable within 15 min, theft detectable.
3. External IdP (Keycloak): full-featured, but heavy to operate on a single VM at launch.

## Decision
Option 2.
- Access token: JWT (EdDSA or HS256 from the secret store), 15 min, claims `sub, role, dept, sid`, held in memory by the SPA.
- Refresh token: random 256-bit value, stored hashed (`RefreshToken.tokenHash`), sent in an httpOnly, Secure,
  SameSite=Strict cookie scoped to `/api/v1/auth`. Each refresh rotates it. Presenting an already rotated token
  revokes the whole `familyId` and is audited.
- Citizens: password + verified email. Staff: password + emailed 6-digit OTP on a new or untrusted device, which is then trusted
  for 30 days (`TrustedDevice`).
- Passwords: argon2id. Lockout after 5 failures in 15 min.
- Deactivation or password reset revokes all of the user's refresh tokens. Access tokens die within 15 min. Admins can force an
  immediate denylist entry on `sid` (Redis) for deactivations.

## Consequences
- The hot path needs no DB read, while revocation and theft detection still work.
- Silent refresh logic is needed in the SPA, and the cookie needs CSRF protection (SameSite=Strict + Origin check).
- Email OTP depends on email deliverability. A TOTP option can be added later without changing the token design.
