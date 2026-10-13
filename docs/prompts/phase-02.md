# Phase 02 — Authentication, users and role-based access

Implement Phase 2: registration, authentication and RBAC. Read @docs/SPEC.md (roles, FR for accounts) and @docs/DATA_MODEL.md first. Plan, then wait for approval.

Backend (apps/api):
- User (single `role` enum, `departmentId` required for OFFICER/SUPERVISOR), Department (seed ADDRESS, POLICE, CIVIL_REGISTRY), CitizenProfile, RefreshToken, OtpCode, StaffInvitation, TrustedDevice models + migration per @docs/DATA_MODEL.md §1 (individual citizens only; no business accounts)
- Citizen self-registration with email verification (emailed one-time code via the notification port; Mailpit in dev); email is required to register
- Unverified citizen accounts cannot submit and are purged after 7 days (FR-002)
- Staff (officer, supervisor, admin) created only by admins; invitation flow with one-time token (72 h); admins can deactivate staff (revokes sessions, releases claims)
- Staff second factor: emailed 6-digit OTP on every new/untrusted device; device trusted 30 days (ADR-0003, FR-008)
- Passwords hashed with argon2id; lockout after N failed attempts; password policy in config
- JWT access token (15 min) + rotating refresh token in an httpOnly, Secure, SameSite=Strict cookie; refresh-token reuse detection revokes the whole family
- @Roles() decorator + RolesGuard + ownership guard (citizens only see their own records; another citizen's record returns 404) + department-scope guard for staff (other department returns 403); deny by default
- Crypto service: AES-256-GCM field encryption for PII with key from env (design for KMS later) + blind index for searchable fields (national ID, phone); encrypted fields per NFR-002
- Audit events for login, logout, failed login, lockout, refresh-token reuse, role/department change, user creation/invitation/deactivation

Frontend (apps/web):
- Register, verify, login, forgot/reset password, profile pages; auth context with silent refresh
- Route guards per role; separate citizen and officer layouts; mobile-first

Tests:
- Unit: guards, token rotation, reuse detection, lockout
- Integration (Testcontainers): full register → verify → login → refresh → logout; a citizen cannot read another citizen's profile (403); an officer endpoint rejects a citizen token; staff login from a new device requires the email OTP
- Playwright: register and log in on a mobile viewport

Done when all tests pass, Swagger shows the auth endpoints with examples, and you have shown me a permissions matrix (role × endpoint) generated from the code that matches @docs/SPEC.md §2.1.
