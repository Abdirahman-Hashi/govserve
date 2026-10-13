# Phase 12 — Security review, load test, UAT fixes

Phase 12: pre-launch hardening. Do not add features.

1. Run /review security on one module at a time (auth, payments, uploads, audit, then the rest) against OWASP ASVS Level 2, with /clear between modules. Group findings by severity with file:line and a concrete fix. Wait for my go-ahead, then fix Critical and High.
2. Authorization matrix test: write an automated test that calls every endpoint with every role (and a staff user from another department) and asserts the permissions matrix in @docs/SPEC.md §2.1.
3. k6 load test: 200 concurrent users browsing, 50 submitting, 20 paying; report p95 latency per endpoint and DB slow queries; fix the top 3 bottlenecks.
4. Accessibility: axe checks in Playwright on key pages; fix WCAG 2.1 AA violations.
5. Produce docs/LAUNCH_CHECKLIST.md with what remains for me to verify manually (key rotation, real gateway credentials, DNS/TLS, legal text, data-protection sign-off), including every open item O-1 to O-8 in @docs/SPEC.md §6, and confirming that no ServiceVersion still has feeIsTest = true.
