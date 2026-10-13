import {
  type ApplicationDetail,
  type ApplicationSummary,
  type AuthSession,
} from '@govserve/shared';
import request from 'supertest';
import { ApplicationsService } from '../../src/applications/applications.service';
import { type ErrorEnvelope } from '../../src/common/filters/error-envelope.filter';
import { DocumentsService } from '../../src/documents/documents.service';
import { VIRUS_SCAN_PORT, type VirusScanPort } from '../../src/documents/virus-scan.port';
import { STORAGE_PORT, type StoragePort } from '../../src/storage/storage.port';
import {
  bearer,
  FILES,
  type Harness,
  signUpCitizen,
  signUpStaff,
  startHarness,
  upload,
  waitForDocument,
} from './harness';

const api = '/api/v1';

const POLICE_ANSWERS = {
  fullName: 'Amina Hassan',
  dateOfBirth: '1990-04-12',
  placeOfBirth: 'Mogadishu',
  idNumber: 'SO1234567',
  mothersFullName: 'Halima Yusuf',
  currentAddress: 'Hodan district, near the market',
  purpose: 'EMPLOYMENT',
};

const BIRTH_ANSWERS = {
  relationship: 'MOTHER',
  subjectFullName: 'Hodan Ali',
  sex: 'FEMALE',
  dateOfBirth: '2019-05-01',
  birthDistrict: 'Hodan',
  placeOfBirthType: 'HOME',
  fatherFullName: 'Ali Warsame',
  motherFullName: 'Amina Hassan',
};

describe('Applications and documents (integration)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });

  afterAll(async () => {
    await h?.close();
  });

  const start = async (session: AuthSession, serviceCode: string) => {
    const res = await request(h.http())
      .post(`${api}/applications`)
      .set(bearer(session))
      .send({ serviceCode });
    expect(res.status).toBe(201);
    return res.body as ApplicationDetail;
  };
  const save = (session: AuthSession, id: string, body: object) =>
    request(h.http()).patch(`${api}/applications/${id}`).set(bearer(session)).send(body);
  const submit = (session: AuthSession, id: string) =>
    request(h.http()).post(`${api}/applications/${id}/submit`).set(bearer(session));
  const actions = async (entityId: string) =>
    (await h.prisma.auditLog.findMany({ where: { entityId }, orderBy: { id: 'asc' } })).map(
      (a) => a.action,
    );

  /** A complete, clean police clearance draft ready to submit. */
  const readyPoliceDraft = async (session: AuthSession) => {
    const app = await start(session, 'POLICE_CLEARANCE');
    await save(session, app.id, { formData: POLICE_ANSWERS, extraCopies: 2 }).expect(200);
    const id = await upload(h, session, app.id, 'NATIONAL_ID_OR_PASSPORT', FILES.pdf());
    const photo = await upload(h, session, app.id, 'PASSPORT_PHOTO', FILES.jpeg(), {
      mime: 'image/jpeg',
      fileName: 'me.jpg',
    });
    await waitForDocument(h, id.ticket.document.id, 'CLEAN');
    await waitForDocument(h, photo.ticket.document.id, 'CLEAN');
    return app;
  };

  describe('happy path: create → autosave → upload → submit (A1, A3)', () => {
    it('should submit, assign a reference, assess the fee and record history, audit and outbox', async () => {
      const { session } = await signUpCitizen(h);
      const app = await readyPoliceDraft(session);
      expect(app).toMatchObject({
        status: 'DRAFT',
        referenceNo: null,
        allowedActions: ['EDIT', 'DELETE', 'SUBMIT'],
      });

      const res = await submit(session, app.id);
      expect(res.status).toBe(200);
      const done = res.body as ApplicationDetail;
      expect(done.status).toBe('AWAITING_PAYMENT');
      expect(done.referenceNo).toMatch(/^GS-\d{4}-\d{6}$/);
      // TEST fee: $15.00 base + 2 × $2.00 copies, exact cents.
      expect(done.feeAssessment).toEqual({
        totalCents: '1900',
        lines: [
          { code: 'BASE', qty: 1, unitCents: '1500', amountCents: '1500' },
          { code: 'COPY', qty: 2, unitCents: '200', amountCents: '400' },
        ],
      });
      expect(done.history.map((x) => x.toStatus)).toEqual(['DRAFT', 'AWAITING_PAYMENT']);
      expect(done.allowedActions).toEqual(['WITHDRAW']);
      expect(await actions(app.id)).toEqual(['APPLICATION_CREATED', 'APPLICATION_SUBMITTED']);
      expect(await h.prisma.outboxEvent.count({ where: { aggregateId: app.id } })).toBe(2);

      // Answers are locked after submit.
      const locked = await save(session, app.id, { formData: { fullName: 'Changed' } });
      expect(locked.status).toBe(409);
    });

    it('should store PII answers encrypted and return them only to the owner', async () => {
      const { session } = await signUpCitizen(h);
      const app = await start(session, 'POLICE_CLEARANCE');
      await save(session, app.id, { formData: POLICE_ANSWERS }).expect(200);
      const row = await h.prisma.applicationData.findUniqueOrThrow({
        where: { applicationId: app.id },
      });
      const plain = JSON.stringify(row.data);
      expect(plain).not.toContain('SO1234567');
      expect(plain).not.toContain('Halima');
      expect(Buffer.from(row.piiEnc!).toString('utf8')).not.toContain('SO1234567');
      expect(row.subjectNationalIdBidx).toBeTruthy();
      const detail = (
        await request(h.http())
          .get(`${api}/applications/${app.id}`)
          .set(bearer(session))
          .expect(200)
      ).body as ApplicationDetail;
      expect(detail.formData).toMatchObject({
        idNumber: 'SO1234567',
        mothersFullName: 'Halima Yusuf',
      });
    });

    it('should reject unknown fields on autosave with 422', async () => {
      const { session } = await signUpCitizen(h);
      const app = await start(session, 'POLICE_CLEARANCE');
      const res = await save(session, app.id, { formData: { role: 'ADMIN' } });
      expect(res.status).toBe(422);
    });
  });

  describe('submit guards (FR-033)', () => {
    it('should list invalid answers and missing documents with 422 and change nothing', async () => {
      const { session } = await signUpCitizen(h);
      const app = await start(session, 'POLICE_CLEARANCE');
      await save(session, app.id, { formData: { ...POLICE_ANSWERS, purpose: 'TRAVEL' } }).expect(
        200,
      );
      await upload(h, session, app.id, 'NATIONAL_ID_OR_PASSPORT', FILES.pdf());

      const res = await submit(session, app.id);
      expect(res.status).toBe(422);
      const paths = ((res.body as ErrorEnvelope).error.details as { path: string }[])
        .map((d) => d.path)
        .sort();
      expect(paths).toEqual(
        expect.arrayContaining(['documents.PASSPORT_PHOTO', 'formData.destinationCountry']),
      );
      const row = await h.prisma.application.findUniqueOrThrow({ where: { id: app.id } });
      expect(row).toMatchObject({ status: 'DRAFT', referenceNo: null });
      expect(await h.prisma.feeAssessment.count({ where: { applicationId: app.id } })).toBe(0);
    });

    it('should accept any one document from a one-of group (proof of address)', async () => {
      const { session } = await signUpCitizen(h);
      const app = await start(session, 'PROOF_OF_ADDRESS');
      await save(session, app.id, {
        formData: {
          fullName: 'Amina Hassan',
          dateOfBirth: '1990-04-12',
          idNumber: 'SO7654321',
          phone: '+252 61 234 5678',
          email: 'amina@example.com',
          district: 'Hodan',
          neighbourhood: 'Taleex',
          streetOrLandmark: 'Near the Taleex junction',
          yearsAtAddress: 4,
          tenure: 'RENT',
        },
      }).expect(200);
      const a = await upload(h, session, app.id, 'NATIONAL_ID_OR_PASSPORT', FILES.pdf());
      const b = await upload(h, session, app.id, 'UTILITY_BILL', FILES.png(), {
        mime: 'image/png',
        fileName: 'bill.png',
      });
      await waitForDocument(h, a.ticket.document.id, 'CLEAN');
      await waitForDocument(h, b.ticket.document.id, 'CLEAN');
      await submit(session, app.id).expect(200);
    });
  });

  describe('one open application per subject (FR-031)', () => {
    it('should refuse a second draft for yourself with 409 and point to the first', async () => {
      const { session } = await signUpCitizen(h);
      const first = await start(session, 'POLICE_CLEARANCE');
      const res = await request(h.http())
        .post(`${api}/applications`)
        .set(bearer(session))
        .send({ serviceCode: 'POLICE_CLEARANCE' });
      expect(res.status).toBe(409);
      expect((res.body as ErrorEnvelope).error).toMatchObject({
        code: 'OPEN_APPLICATION_EXISTS',
        details: { applicationId: first.id },
      });
    });

    it('should allow two child drafts but only one submitted application per child', async () => {
      const { session } = await signUpCitizen(h);
      const ready = async () => {
        const app = await start(session, 'BIRTH_CERTIFICATE');
        await save(session, app.id, { formData: BIRTH_ANSWERS }).expect(200);
        const doc = await upload(h, session, app.id, 'APPLICANT_ID', FILES.pdf());
        await waitForDocument(h, doc.ticket.document.id, 'CLEAN');
        return app;
      };
      const a = await ready();
      const b = await ready();
      await submit(session, a.id).expect(200);
      const second = await submit(session, b.id);
      expect(second.status).toBe(409);
      expect((second.body as ErrorEnvelope).error.code).toBe('OPEN_APPLICATION_EXISTS');
      const row = await h.prisma.application.findUniqueOrThrow({ where: { id: b.id } });
      expect(row.status).toBe('DRAFT');
      const submitted = await h.prisma.application.findUniqueOrThrow({ where: { id: a.id } });
      expect(submitted).toMatchObject({ subjectType: 'CHILD', relationship: 'MOTHER' });
    });

    it('should let exactly one of two concurrent submits succeed', async () => {
      const { session } = await signUpCitizen(h);
      const app = await readyPoliceDraft(session);
      const results = await Promise.all([submit(session, app.id), submit(session, app.id)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await h.prisma.feeAssessment.count({ where: { applicationId: app.id } })).toBe(1);
      expect(
        await h.prisma.applicationStatusHistory.count({
          where: { applicationId: app.id, toStatus: 'AWAITING_PAYMENT' },
        }),
      ).toBe(1);
    });
  });

  describe('withdraw, delete and purge (A22, A2, A4)', () => {
    it('should withdraw a submitted application and then refuse further transitions with 409', async () => {
      const { session } = await signUpCitizen(h);
      const app = await readyPoliceDraft(session);
      await submit(session, app.id).expect(200);
      const res = await request(h.http())
        .post(`${api}/applications/${app.id}/withdraw`)
        .set(bearer(session));
      expect((res.body as ApplicationDetail).status).toBe('WITHDRAWN');
      const again = await request(h.http())
        .post(`${api}/applications/${app.id}/withdraw`)
        .set(bearer(session));
      expect(again.status).toBe(409);
      expect((again.body as ErrorEnvelope).error.code).toBe('INVALID_TRANSITION');
      // A withdrawn application frees the subject for a new one.
      await start(session, 'POLICE_CLEARANCE');
    });

    it('should refuse to withdraw a draft (delete it instead) and delete its uploads', async () => {
      const { session } = await signUpCitizen(h);
      const app = await start(session, 'POLICE_CLEARANCE');
      const up = await upload(h, session, app.id, 'NATIONAL_ID_OR_PASSPORT', FILES.pdf());
      const { storageKey } = await h.prisma.document.findUniqueOrThrow({
        where: { id: up.ticket.document.id },
      });
      const storage = h.app.get<StoragePort>(STORAGE_PORT);
      expect(await storage.head(storageKey)).not.toBeNull();

      await request(h.http())
        .post(`${api}/applications/${app.id}/withdraw`)
        .set(bearer(session))
        .expect(409);
      await request(h.http())
        .delete(`${api}/applications/${app.id}`)
        .set(bearer(session))
        .expect(204);
      expect(await h.prisma.application.findUnique({ where: { id: app.id } })).toBeNull();
      expect(await storage.head(storageKey)).toBeNull();
      expect(await actions(app.id)).toEqual(['APPLICATION_CREATED', 'APPLICATION_DRAFT_DELETED']);
    });

    it('should abandon drafts idle past the retention setting', async () => {
      const { session } = await signUpCitizen(h);
      const app = await start(session, 'POLICE_CLEARANCE');
      await h.prisma.application.update({
        where: { id: app.id },
        data: { updatedAt: new Date(Date.now() - 91 * 86_400_000) },
      });
      const count = await h.app.get(ApplicationsService).abandonIdleDrafts(90);
      expect(count).toBeGreaterThanOrEqual(1);
      expect((await h.prisma.application.findUniqueOrThrow({ where: { id: app.id } })).status).toBe(
        'ABANDONED',
      );
      expect(await actions(app.id)).toContain('APPLICATION_ABANDONED');
    });
  });

  describe('corrections lock everything except flagged items', () => {
    it('should allow only flagged fields and documents to change', async () => {
      const { session } = await signUpCitizen(h);
      const officer = await signUpStaff(h, 'OFFICER', 'POLICE');
      const app = await readyPoliceDraft(session);
      await submit(session, app.id).expect(200);
      // Phase 06 creates corrections through the review workflow; seed one directly here.
      await h.prisma.application.update({
        where: { id: app.id },
        data: { status: 'CORRECTION_REQUESTED' },
      });
      await h.prisma.correctionRequest.create({
        data: {
          applicationId: app.id,
          round: 1,
          requestedById: officer.session.user.id,
          dueAt: new Date(Date.now() + 30 * 86_400_000),
          items: {
            create: [
              { kind: 'FIELD', target: 'placeOfBirth', comment: 'Please give the district too' },
              { kind: 'DOCUMENT', target: 'PASSPORT_PHOTO', comment: 'Photo is blurred' },
            ],
          },
        },
      });

      await save(session, app.id, { formData: { placeOfBirth: 'Mogadishu, Hodan' } }).expect(200);
      const locked = await save(session, app.id, { formData: { fullName: 'Someone Else' } });
      expect(locked.status).toBe(409);
      expect((locked.body as ErrorEnvelope).error.code).toBe('FIELD_LOCKED');
      await save(session, app.id, { extraCopies: 5 }).expect(409);

      await upload(h, session, app.id, 'PASSPORT_PHOTO', FILES.png(), {
        mime: 'image/png',
        fileName: 'new.png',
      });
      const lockedDoc = await request(h.http())
        .post(`${api}/applications/${app.id}/documents`)
        .set(bearer(session))
        .send({
          docType: 'NATIONAL_ID_OR_PASSPORT',
          fileName: 'x.pdf',
          mime: 'application/pdf',
          sizeBytes: 100,
          sha256: 'a'.repeat(64),
        });
      expect(lockedDoc.status).toBe(409);

      const detail = (
        await request(h.http()).get(`${api}/applications/${app.id}`).set(bearer(session))
      ).body as ApplicationDetail;
      expect(detail).toMatchObject({
        editableFields: ['placeOfBirth'],
        editableDocTypes: ['PASSPORT_PHOTO'],
        correction: { round: 1 },
      });
    });
  });

  describe('uploads (FR-035)', () => {
    it('should reject a file whose content is not the declared type', async () => {
      const { session } = await signUpCitizen(h);
      const app = await start(session, 'POLICE_CLEARANCE');
      const fake = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(500, ' '));
      const res = await upload(h, session, app.id, 'NATIONAL_ID_OR_PASSPORT', fake, {
        fileName: 'id.pdf',
      });
      expect(res.put.status).toBe(200);
      expect(res.complete.status).toBe(422);
      expect((res.complete.body as ErrorEnvelope).error.code).toBe('UPLOAD_REJECTED');
      expect(
        (await h.prisma.document.findUniqueOrThrow({ where: { id: res.ticket.document.id } }))
          .status,
      ).toBe('REJECTED');
    });

    it('should reject a checksum mismatch', async () => {
      const { session } = await signUpCitizen(h);
      const app = await start(session, 'POLICE_CLEARANCE');
      const res = await upload(h, session, app.id, 'NATIONAL_ID_OR_PASSPORT', FILES.pdf(), {
        declaredSha256: 'b'.repeat(64),
      });
      expect(res.complete.status).toBe(422);
    });

    it('should refuse oversized files, disallowed types and undeclared documents before upload', async () => {
      const { session } = await signUpCitizen(h);
      const app = await start(session, 'POLICE_CLEARANCE');
      const ticket = (body: object) =>
        request(h.http())
          .post(`${api}/applications/${app.id}/documents`)
          .set(bearer(session))
          .send(body);
      const base = {
        docType: 'PASSPORT_PHOTO',
        fileName: 'p.jpg',
        mime: 'image/jpeg',
        sizeBytes: 1000,
        sha256: 'a'.repeat(64),
      };
      expect((await ticket({ ...base, sizeBytes: 6 * 1024 * 1024 })).status).toBe(422);
      expect((await ticket({ ...base, mime: 'application/pdf' })).status).toBe(422); // photos must be images
      expect((await ticket({ ...base, docType: 'BANK_STATEMENT' })).status).toBe(422);
    });

    it('should not let the storage accept a different size than was signed', async () => {
      const { session } = await signUpCitizen(h);
      const app = await start(session, 'POLICE_CLEARANCE');
      const res = await upload(h, session, app.id, 'NATIONAL_ID_OR_PASSPORT', FILES.pdf(4096), {
        declaredSize: 2048,
      });
      expect(res.put.ok).toBe(false);
      expect(res.complete.status).toBe(409);
    });

    it('should replace an earlier upload of the same type and keep the old one as history', async () => {
      const { session } = await signUpCitizen(h);
      const app = await start(session, 'POLICE_CLEARANCE');
      const first = await upload(h, session, app.id, 'NATIONAL_ID_OR_PASSPORT', FILES.pdf());
      const second = await upload(h, session, app.id, 'NATIONAL_ID_OR_PASSPORT', FILES.pdf(3000));
      const old = await h.prisma.document.findUniqueOrThrow({
        where: { id: first.ticket.document.id },
      });
      expect(old.supersededById).toBe(second.ticket.document.id);
      const detail = (
        await request(h.http()).get(`${api}/applications/${app.id}`).set(bearer(session))
      ).body as ApplicationDetail;
      expect(detail.documents.map((d) => d.id)).toEqual([second.ticket.document.id]);
    });

    it('should audit every document change with department, never the file name', async () => {
      const { session } = await signUpCitizen(h);
      const app = await start(session, 'POLICE_CLEARANCE');
      const name = 'amina-hassan-passport.pdf';
      const first = await upload(h, session, app.id, 'NATIONAL_ID_OR_PASSPORT', FILES.pdf(), {
        fileName: name,
      });
      await waitForDocument(h, first.ticket.document.id, 'CLEAN');
      const second = await upload(h, session, app.id, 'NATIONAL_ID_OR_PASSPORT', FILES.pdf(3000), {
        fileName: name,
      });
      await waitForDocument(h, second.ticket.document.id, 'CLEAN');
      const bad = await upload(h, session, app.id, 'PASSPORT_PHOTO', FILES.pdf(), {
        mime: 'image/jpeg',
        fileName: name,
      });
      expect(bad.complete.status).toBe(422);
      await request(h.http())
        .delete(`${api}/documents/${second.ticket.document.id}`)
        .set(bearer(session))
        .expect(204);

      expect(await actions(first.ticket.document.id)).toEqual([
        'DOCUMENT_UPLOAD_REQUESTED',
        'DOCUMENT_UPLOADED',
        'DOCUMENT_CLEAN',
      ]);
      expect(await actions(second.ticket.document.id)).toEqual([
        'DOCUMENT_UPLOAD_REQUESTED',
        'DOCUMENT_UPLOADED',
        'DOCUMENT_CLEAN',
        'DOCUMENT_REMOVED',
      ]);
      expect(await actions(bad.ticket.document.id)).toEqual([
        'DOCUMENT_UPLOAD_REQUESTED',
        'DOCUMENT_REJECTED',
      ]);

      const rows = await h.prisma.auditLog.findMany({
        where: {
          entityType: 'Document',
          entityId: {
            in: [first.ticket.document.id, second.ticket.document.id, bad.ticket.document.id],
          },
        },
      });
      const police = await h.prisma.department.findUniqueOrThrow({ where: { code: 'POLICE' } });
      expect(rows.every((r) => r.departmentId === police.id)).toBe(true);
      expect(JSON.stringify(rows.map((r) => [r.before, r.after]))).not.toContain('amina-hassan');
      const uploaded = rows.find(
        (r) => r.entityId === second.ticket.document.id && r.action === 'DOCUMENT_UPLOADED',
      );
      expect(uploaded?.after).toMatchObject({
        replaces: [first.ticket.document.id],
        docType: 'NATIONAL_ID_OR_PASSPORT',
      });
      const removed = rows.find((r) => r.action === 'DOCUMENT_REMOVED');
      expect(removed?.after).toMatchObject({ restored: [first.ticket.document.id] });
      const rejected = rows.find((r) => r.action === 'DOCUMENT_REJECTED');
      expect(rejected?.after).toMatchObject({
        status: 'REJECTED',
        reason: 'The file content does not match its type',
      });
      // Removing the newer upload restores the earlier one.
      expect(
        (await h.prisma.document.findUniqueOrThrow({ where: { id: first.ticket.document.id } }))
          .supersededById,
      ).toBeNull();
    });

    it('should hide another citizen’s application and files with 404', async () => {
      const a = await signUpCitizen(h);
      const b = await signUpCitizen(h);
      const app = await start(a.session, 'POLICE_CLEARANCE');
      const up = await upload(h, a.session, app.id, 'NATIONAL_ID_OR_PASSPORT', FILES.pdf());
      await waitForDocument(h, up.ticket.document.id, 'CLEAN');
      await request(h.http())
        .get(`${api}/applications/${app.id}`)
        .set(bearer(b.session))
        .expect(404);
      await request(h.http())
        .get(`${api}/documents/${up.ticket.document.id}/download`)
        .set(bearer(b.session))
        .expect(404);
      await request(h.http())
        .delete(`${api}/documents/${up.ticket.document.id}`)
        .set(bearer(b.session))
        .expect(404);
      await save(b.session, app.id, { extraCopies: 1 }).expect(404);
      const list = (await request(h.http()).get(`${api}/applications`).set(bearer(b.session)))
        .body as ApplicationSummary[];
      expect(list.map((x) => x.id)).not.toContain(app.id);

      // The owner gets a short-lived link that really serves the file.
      const ticket = await request(h.http())
        .get(`${api}/documents/${up.ticket.document.id}/download`)
        .set(bearer(a.session))
        .expect(200);
      const file = await fetch((ticket.body as { url: string }).url);
      expect(file.status).toBe(200);
      expect(
        Buffer.from(await file.arrayBuffer())
          .subarray(0, 5)
          .toString(),
      ).toBe('%PDF-');
    });

    it('should mark an infected file and delete it from storage', async () => {
      const { session } = await signUpCitizen(h);
      const app = await start(session, 'POLICE_CLEARANCE');
      const up = await upload(h, session, app.id, 'NATIONAL_ID_OR_PASSPORT', FILES.pdf());
      await waitForDocument(h, up.ticket.document.id, 'CLEAN');
      // Simulate the scanner flagging it: put it back in quarantine and scan with a scanner that finds a virus.
      await h.prisma.document.update({
        where: { id: up.ticket.document.id },
        data: { status: 'QUARANTINED' },
      });
      const scanner = h.app.get<VirusScanPort>(VIRUS_SCAN_PORT);
      jest
        .spyOn(scanner, 'scan')
        .mockResolvedValueOnce({ clean: false, signature: 'Eicar-Test-Signature' });
      await h.app.get(DocumentsService).scan(up.ticket.document.id);
      const doc = await h.prisma.document.findUniqueOrThrow({
        where: { id: up.ticket.document.id },
      });
      expect(doc.status).toBe('INFECTED');
      expect(await h.app.get<StoragePort>(STORAGE_PORT).head(doc.storageKey)).toBeNull();
      expect(await actions(doc.id)).toEqual([
        'DOCUMENT_UPLOAD_REQUESTED',
        'DOCUMENT_UPLOADED',
        'DOCUMENT_CLEAN',
        'DOCUMENT_INFECTED',
      ]);
      await request(h.http())
        .get(`${api}/documents/${doc.id}/download`)
        .set(bearer(session))
        .expect(409);
    });
  });

  describe('authorization', () => {
    it('should refuse staff on citizen application endpoints with 403', async () => {
      const officer = await signUpStaff(h, 'OFFICER', 'POLICE');
      await request(h.http()).get(`${api}/applications`).set(bearer(officer.session)).expect(403);
      await request(h.http())
        .post(`${api}/applications`)
        .set(bearer(officer.session))
        .send({ serviceCode: 'POLICE_CLEARANCE' })
        .expect(403);
    });
  });
});
