# GovServe Revenue & Service Portal — Product Brief

> Seed spec from the application description. Phase 0 expands this into a full functional spec
> with numbered requirements (FR-xxx / NFR-xxx).

## Summary
GovServe is a secure, mobile-responsive full-stack application that digitises government service
requests and revenue collection.

**Citizens** can create accounts, submit service applications, upload supporting
documents, view fee assessments, record or initiate payments, track application status, and
download digitally verifiable receipts.

**Government officers** use role-based work queues to review submissions, request corrections,
approve or reject applications, confirm payments, and monitor service-delivery performance.

## Technology
- Frontend: React + TypeScript
- Backend: Node.js + NestJS
- Database: PostgreSQL (transactional data)
- Documented RESTful APIs (OpenAPI/Swagger)
- JWT authentication + role-based access control
- Validation and encryption of sensitive information
- Audit log of critical actions
- Docker containers, unit + integration tests, Git, CI/CD to a cloud-ready environment

## Core capabilities
1. Citizen and officer registration, authentication and role-based access
2. Configurable service catalogue, application forms and document uploads
3. Fee assessment, payment-status tracking and receipt generation
4. Officer review, approval, rejection and correction-request workflows
5. Email notification integration for status updates (SMS later)
6. Searchable application and transaction history
7. Management dashboard for collections, application volumes, processing times and pending work
8. Audit trail covering status changes, payment events and administrative actions
9. Responsive user interface for desktop and mobile devices
10. OpenAPI/Swagger documentation for application integrations

## Decided
See docs/DECISIONS.md: USD only; mobile money, bank, cash and card; officer-confirmed manual payments,
gateway-confirmed cards; individual citizens only; roles citizen, officer, supervisor, admin; English only; email notifications;
three pilot services (proof of address, police clearance, birth certificate; see docs/SERVICES.md),
each issuing a signed, QR-verifiable certificate; hosting portable (Docker Compose), target TBD.

## Open questions (resolve in Phase 0)
- Permissions per role and department structure
- Application and payment state machines
- Every 'Confirm' item in docs/SERVICES.md: authorities, fees, documents, validity, in-person steps
- Supervisor-confirmation threshold, partial payments, refunds
- Receipt verification content
- Data retention, PII fields
