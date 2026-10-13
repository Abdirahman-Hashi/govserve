# GovServe build progress

Tick a phase only when lint, typecheck and tests are green and the phase's acceptance checks pass.

| Phase | Delivers | Depends on | Status |
| --- | --- | --- | --- |
| 00 | Spec, data model, state machines, ADRs (no code) | — | [x] |
| 01 | Monorepo scaffold, Docker Compose, CI skeleton | 00 | [ ] |
| 02 | Auth, JWT, RBAC, users | 01 | [ ] |
| 03 | Service catalogue + configurable forms + fee engine | 02 | [ ] |
| 04 | Applications + document uploads | 03 | [ ] |
| 05 | Fee assessment, payments, verifiable receipts | 04 | [ ] |
| 06 | Officer work queues + review workflow | 04, 05 | [ ] |
| 07 | Email notifications | 06 | [ ] |
| 08 | Search + application/transaction history | 06 | [ ] |
| 09 | Management dashboard | 05, 06 | [ ] |
| 10 | Audit trail hardening + OpenAPI polish | 02–09 | [ ] |
| 11 | Production Docker, CI/CD, cloud deploy | 10 | [ ] |
| 12 | Security review, load test, UAT fixes | 11 | [ ] |

## Notes
<!-- /ship appends a short note per phase: what changed, follow-ups, decisions -->

**Phase 00 (2026-10-13):** Approved SERVICES, SPEC (FR/NFR, permission matrix), DATA_MODEL and STATE_MACHINES; ADRs 0001–0006 accepted; Phase 0 decisions recorded in DECISIONS.md; phase 01–12 prompts aligned with the spec.
Follow-ups: open items O-1 to O-8 in SPEC §6 (owner: Abdirahman Hashi): official fees, validity, SLAs, signing offices, legal retention sign-off, holiday calendar, card gateway, hosting target.
