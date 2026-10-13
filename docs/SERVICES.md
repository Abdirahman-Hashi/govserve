# GovServe pilot services

GovServe serves **one user: the individual citizen**. At launch a citizen can apply online for the three
documents they most often need, pay, track progress, and download a digitally signed certificate.

Items marked **Confirm** are first drafts. Phase 0 must confirm them with the issuing authority
before any code depends on them. Fees are left blank on purpose: use the official fee, never a guess.

## What all three have in common
- Applicant = the logged-in citizen. The **subject** is the person the document is about
  (usually the applicant; for a birth certificate it may be their child).
- Every application needs identity: national ID / passport number and an upload of the ID.
- Approval produces a **certificate PDF** with a unique certificate number, issue date, a QR code, and
  an Ed25519 signature (same signing service as receipts). The QR opens a public page that confirms
  the certificate is genuine and still valid.
- Certificates can be **revoked** by a supervisor (with a reason); the public page then shows REVOKED.
- Fees in USD. Confirm: is there an urgent/express option at a higher fee?

## 1. Proof of address (government-issued address / residence certificate)
| Item | Draft |
| --- | --- |
| Purpose | Proves where the citizen lives; needed for bank accounts, jobs, school, SIM registration |
| Issuing authority | **Confirm** (e.g. district or regional administration) |
| Form fields | Full name, date of birth, ID number, phone, email, region, district, neighbourhood/village, street or landmark description, house number (if any), years at address, own/rent |
| Documents | National ID or passport; one supporting proof (**Confirm** which are accepted: letter from local/neighbourhood leader, rental agreement, utility bill, property document) |
| Officer checks | ID matches applicant; supporting proof names the applicant and the address |
| In-person step | **Confirm**: is a field visit or local-leader confirmation required? |
| Output | Address certificate PDF |
| Valid for | **Confirm** (e.g. 6 or 12 months) |
| Fee (USD) | **Confirm** |
| Target processing time | **Confirm** (working days) |

## 2. Criminal record certificate (police clearance)
| Item | Draft |
| --- | --- |
| Purpose | States whether the citizen has a criminal record; needed for jobs, travel, visas, study abroad |
| Issuing authority | **Confirm** (police / criminal investigation department) |
| Form fields | Full name, other names used, date and place of birth, ID number, mother's full name, current address, purpose of certificate (employment, travel, visa, other), destination country if travel |
| Documents | National ID or passport; passport-size photo |
| Officer checks | Identity; search of criminal records (manual by an officer at launch; record systems are not integrated) |
| In-person step | **Confirm**: are fingerprints taken in person? If yes, the workflow adds an appointment step that an officer marks complete |
| Output | Police clearance certificate PDF: "no record found" or a referral to collect in person. **Confirm** how a positive record is handled; never show record details online |
| Valid for | **Confirm** (often 3–6 months) |
| Fee (USD) | **Confirm** |
| Target processing time | **Confirm** |

## 3. Birth certificate
| Item | Draft |
| --- | --- |
| Purpose | Official record of birth; needed for ID, passport, school enrolment, inheritance |
| Issuing authority | **Confirm** (civil registration office / municipality) |
| Types | **Confirm**: (a) late registration of a birth never registered, (b) copy of an existing registration, or both |
| Applying for | Self, or a child (parent/guardian applies; applicant's relationship is recorded) |
| Form fields | Child/subject full name, sex, date and place of birth (region, district, hospital/home), father's full name and ID, mother's full name and ID, applicant relationship |
| Documents | Applicant ID; parents' IDs; hospital/birth notification if available; **Confirm** alternatives for home births (e.g. witness statement, local leader letter) |
| Officer checks | Parent identities; supporting birth evidence; duplicate check (same subject already registered) |
| In-person step | **Confirm**: are witnesses or parents required to appear? |
| Output | Birth certificate PDF |
| Valid for | Does not expire |
| Fee (USD) | **Confirm** (may differ for late registration vs copy) |
| Target processing time | **Confirm** |

## Public verification page (all three)
Shows: certificate type, certificate number, holder's full name, issue date, expiry date (if any),
status VALID / EXPIRED / REVOKED. Never shows ID numbers, address details, parents' details or
record contents. **Confirm** that showing the holder's name is acceptable.
