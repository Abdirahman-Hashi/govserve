# GovServe pilot services

GovServe serves **one user: the individual citizen**. At launch a citizen can apply online for the three
documents they most often need, pay, track progress, and download a digitally signed certificate.

**Pilot jurisdiction:** Somalia, Banadir Regional Administration (BRA), Mogadishu. Confirmed in Phase 0 on 2026-10-13.

Items marked **OPEN** cannot be confirmed from the project side. Each one names an owner who must confirm it with the
issuing authority before go-live. Until then they are admin-configurable values, and the seed data uses clearly
labelled **TEST** values. Fees are never guessed into production config.

## What all three have in common
- Applicant = the logged-in citizen. The **subject** is the person the document is about. It is the applicant for
  proof of address and police clearance, and the applicant or their child for a birth certificate.
- Every application needs identity: national ID / passport number and an upload of the ID.
- **One open application per service per subject.** A second one is blocked until the first is decided,
  withdrawn or abandoned. Duplicate-copy requests are exempt.
- **Fees:** a flat base fee per service plus a per-copy fee for each extra certified copy. There is no express option, no
  penalty and no waiver at launch. No one can override an assessed fee.
- **Payment before review:** the fee is assessed on submit, and the application enters the officer queue only once
  it is paid in full. Partial payments add up toward the total.
- **Refunds:** none when an application is rejected (the fee is a processing fee). A refund is possible only for a duplicate payment, an overpayment,
  or a withdrawal before review starts. A supervisor approves each one.
- **Corrections:** the officer flags specific fields and documents, and only those unlock. The citizen has 30 days to resubmit, after which the
  application becomes ABANDONED. There are at most 3 correction rounds.
- Approval produces a **certificate PDF** with a unique certificate number, issue date, a QR code, and an Ed25519
  signature (same signing service as receipts). The QR opens a public page that confirms the certificate is genuine
  and still valid.
- Certificates can be **revoked** by a supervisor with a reason (FRAUD, ERROR, CHARGEBACK, SUPERSEDED). The public page
  then shows REVOKED.
- **Duplicates:** a citizen can order a duplicate of a VALID certificate (per-copy fee). The duplicate gets a new
  certificate number linked to the original and the same expiry. A correction to a certificate needs a new application;
  the old certificate is revoked as SUPERSEDED when the new one is issued. An expired certificate needs a fresh application.

## Departments
| Department | Service | Officers see |
| --- | --- | --- |
| Address Office (BRA district administration) | Proof of address | Address queue and its payments only |
| Police / CID | Police clearance | Police queue and its payments only |
| Civil Registry | Birth certificate | Birth queue and its payments only |

Each officer belongs to exactly one department. Supervisors are scoped to one department too. Admins are not
scoped and do not review applications.

## 1. Proof of address (residence certificate)
| Item | Confirmed |
| --- | --- |
| Purpose | Proves where the citizen lives; needed for bank accounts, jobs, school, SIM registration |
| Issuing authority | Banadir Regional Administration, district administration of the applicant's district. Exact signing office: **OPEN — owner: Abdirahman Hashi** |
| Department | Address Office |
| Form fields | Full name, date of birth, ID number, phone, email, district, neighbourhood (xaafad)/village, street or landmark description, house number (if any), years at address, own/rent |
| Documents | National ID or passport (required) + **any one** of: neighbourhood (xaafad) leader letter, rental agreement, utility bill, property document |
| Officer checks | ID matches applicant; supporting proof names the applicant and the address. The officer may phone the neighbourhood leader (outcome recorded as a note) |
| In-person step | None. No field visit |
| Approval | Officer alone |
| Output | Address certificate PDF |
| Valid for | 6 months (configurable). Official period: **OPEN — owner: Abdirahman Hashi** |
| Fee (USD) | Base + per-copy. **OPEN — owner: Abdirahman Hashi** (seed: TEST $10.00 base, $2.00 per copy) |
| Target processing time | **OPEN — owner: Abdirahman Hashi** (seed: TEST 5 working days) |

## 2. Criminal record certificate (police clearance)
| Item | Confirmed |
| --- | --- |
| Purpose | States whether the citizen has a criminal record; needed for jobs, travel, visas, study abroad |
| Issuing authority | Somali Police Force, Criminal Investigation Department (CID), Mogadishu. Signing office: **OPEN — owner: Abdirahman Hashi** |
| Department | Police / CID |
| Form fields | Full name, other names used, date and place of birth, ID number, mother's full name, current address, purpose of certificate (employment, travel, visa, other), destination country if travel |
| Documents | National ID or passport; passport-size photo |
| Officer checks | Identity; manual search of criminal records by an officer (record systems are not integrated) |
| In-person step | **Fingerprints, always.** After payment, the officer books a fingerprint appointment (the citizen is emailed) and marks it attended before deciding |
| Outcome: no record | Officer approves → police clearance certificate PDF ("no record found") |
| Outcome: record found | **No certificate is issued online.** The officer proposes REFERRED and a supervisor confirms. The citizen is told to visit CID in person. Record details are never stored in free text visible to the citizen and never shown online; the officer's note is encrypted at rest |
| Valid for | 6 months (configurable). Official period: **OPEN — owner: Abdirahman Hashi** |
| Fee (USD) | Base + per-copy. **OPEN — owner: Abdirahman Hashi** (seed: TEST $15.00 base, $2.00 per copy) |
| Target processing time | **OPEN — owner: Abdirahman Hashi** (seed: TEST 10 working days, clock paused while awaiting appointment) |

## 3. Birth certificate (late registration)
| Item | Confirmed |
| --- | --- |
| Purpose | Official record of birth; needed for ID, passport, school enrolment, inheritance |
| Issuing authority | BRA civil registration office. Exact office: **OPEN — owner: Abdirahman Hashi** |
| Department | Civil Registry |
| Types | **Late registration only** (a birth never registered). Copies of existing registrations are out of scope at launch; certificates issued by GovServe can be duplicated as above |
| Applying for | Self, or a child (parent/guardian applies; applicant's relationship is recorded) |
| Form fields | Subject full name, sex, date and place of birth (district, hospital/home), father's full name and ID, mother's full name and ID, applicant relationship |
| Documents | Applicant ID; parents' IDs (where available); hospital birth notification if any; for home births a neighbourhood-leader letter is optional supporting evidence |
| Officer checks | Parent identities; supporting birth evidence; duplicate check (a certificate already issued for the same subject name + DOB + mother's name) |
| In-person step | **Always.** Parents (and witnesses where the officer requires them) appear at a Civil Registry appointment. The officer records who attended |
| Approval | Officer verifies, then **a supervisor always gives the second approval** before issue |
| Output | Birth certificate PDF |
| Valid for | Does not expire |
| Fee (USD) | Base + per-copy. **OPEN — owner: Abdirahman Hashi** (seed: TEST $20.00 base, $2.00 per copy) |
| Target processing time | **OPEN — owner: Abdirahman Hashi** (seed: TEST 15 working days, clock paused while awaiting appointment) |

## Public verification page (all three)
Shows: certificate type, certificate number, status VALID / EXPIRED / REVOKED, issue date, expiry date (if any), and the
holder's name **masked** (first name in full, initials for other names, e.g. "Ahmed M*** H***"). A verifier can type
the full name they were given and the page answers only "matches" or "does not match". The page is rate-limited.
It never shows ID numbers, address details, parents' details, record contents or the revocation reason text.
