import {
  type ApplicationDetail,
  type AuthSession,
  type CertificateSummary,
  type PaymentDto,
  type PublicCertificate,
  type PublicKeys,
  type QueueItem,
  type StaffApplication,
  verifySignature,
} from '@govserve/shared';
import request from 'supertest';
import { CertificatesService } from '../../src/certificates/certificates.service';
import { type ErrorEnvelope } from '../../src/common/filters/error-envelope.filter';
import { ReviewService } from '../../src/review/review.service';
import { StaffService } from '../../src/users/staff.service';
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
import { ANSWERS, DOCS, type Service } from './fixtures';

const api = '/api/v1';
type Staff = Awaited<ReturnType<typeof signUpStaff>>;
const bigints = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

let refCounter = 0;
const txRef = () => `RV${Date.now()}${(refCounter += 1)}`;

describe('Officer review and certificates (integration)', () => {
  let h: Harness;
  let addrOfficer: Staff;
  let addrOfficer2: Staff;
  let addrSup: Staff;
  let polOfficer: Staff;
  let polSup: Staff;
  let civOfficer: Staff;
  let civSupA: Staff;
  let civSupB: Staff;

  beforeAll(async () => {
    h = await startHarness();
    addrOfficer = await signUpStaff(h, 'OFFICER', 'ADDRESS');
    addrOfficer2 = await signUpStaff(h, 'OFFICER', 'ADDRESS');
    addrSup = await signUpStaff(h, 'SUPERVISOR', 'ADDRESS');
    polOfficer = await signUpStaff(h, 'OFFICER', 'POLICE');
    polSup = await signUpStaff(h, 'SUPERVISOR', 'POLICE');
    civOfficer = await signUpStaff(h, 'OFFICER', 'CIVIL_REGISTRY');
    civSupA = await signUpStaff(h, 'SUPERVISOR', 'CIVIL_REGISTRY');
    civSupB = await signUpStaff(h, 'SUPERVISOR', 'CIVIL_REGISTRY');
  });

  afterAll(async () => {
    await h?.close();
  });

  const post = (who: AuthSession, path: string, body: object = {}) =>
    request(h.http()).post(`${api}${path}`).set(bearer(who)).send(body);
  const staffView = async (who: Staff, id: string) =>
    (
      await request(h.http())
        .get(`${api}/review/applications/${id}`)
        .set(bearer(who.session))
        .expect(200)
    ).body as StaffApplication;
  const citizenView = async (session: AuthSession, id: string) =>
    (await request(h.http()).get(`${api}/applications/${id}`).set(bearer(session)).expect(200))
      .body as ApplicationDetail;

  /** Pays the full fee by mobile money and has a department officer confirm it. */
  async function payInFull(session: AuthSession, app: ApplicationDetail, confirmer: Staff) {
    const paid = await post(session, `/applications/${app.id}/payments`, {
      channel: 'MOBILE_MONEY',
      provider: 'EVC_PLUS',
      reference: txRef(),
      amountCents: app.feeAssessment!.totalCents,
      paidAt: '2026-10-13',
    }).expect(201);
    await post(confirmer.session, `/staff/payments/${(paid.body as PaymentDto).id}/confirm`).expect(
      200,
    );
  }

  /** A paid application waiting in its department queue. */
  async function queued(service: Service, confirmer: Staff, session?: AuthSession) {
    const citizen = session ?? (await signUpCitizen(h)).session;
    const app = (await post(citizen, '/applications', { serviceCode: service }).expect(201))
      .body as ApplicationDetail;
    await request(h.http())
      .patch(`${api}/applications/${app.id}`)
      .set(bearer(citizen))
      .send({ formData: ANSWERS[service] })
      .expect(200);
    for (const [docType, kind] of DOCS[service]) {
      const u = await upload(
        h,
        citizen,
        app.id,
        docType,
        FILES[kind](),
        kind === 'jpeg' ? { mime: 'image/jpeg', fileName: 'photo.jpg' } : {},
      );
      await waitForDocument(h, u.ticket.document.id, 'CLEAN');
    }
    const submitted = (await post(citizen, `/applications/${app.id}/submit`).expect(200))
      .body as ApplicationDetail;
    await payInFull(citizen, submitted, confirmer);
    expect((await citizenView(citizen, app.id)).status).toBe('QUEUED');
    return { session: citizen, id: app.id };
  }

  async function claimed(who: Staff, id: string) {
    const app = await staffView(who, id);
    return (
      await post(who.session, `/review/applications/${id}/claim`, { version: app.version }).expect(
        200,
      )
    ).body as StaffApplication;
  }

  /** Books the in-person step, moves it into the past and records attendance. */
  async function attended(who: Staff, id: string, attendees?: { name: string; role: string }[]) {
    let app = await staffView(who, id);
    app = (
      await post(who.session, `/review/applications/${id}/appointment`, {
        version: app.version,
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        location: 'Banadir HQ, room 4',
      }).expect(200)
    ).body as StaffApplication;
    expect(app.status).toBe('AWAITING_APPOINTMENT');
    await h.prisma.appointment.updateMany({
      where: { applicationId: id, status: 'SCHEDULED' },
      data: { scheduledAt: new Date(Date.now() - 60_000) },
    });
    return (
      await post(who.session, `/review/applications/${id}/appointment/outcome`, {
        version: app.version,
        outcome: 'ATTENDED',
        ...(attendees && { attendees }),
      }).expect(200)
    ).body as StaffApplication;
  }

  describe('queues and access', () => {
    it('should show staff only their own department and refuse citizens', async () => {
      const { session, id } = await queued('PROOF_OF_ADDRESS', addrOfficer);
      await request(h.http()).get(`${api}/review/queue`).set(bearer(session)).expect(403);
      const mine = (
        await request(h.http())
          .get(`${api}/review/queue`)
          .set(bearer(addrOfficer.session))
          .expect(200)
      ).body as QueueItem[];
      expect(mine.map((i) => i.id)).toContain(id);
      expect(mine.find((i) => i.id === id)).toMatchObject({
        status: 'QUEUED',
        slaRisk: 'ON_TRACK',
      });
      const police = (
        await request(h.http())
          .get(`${api}/review/queue`)
          .set(bearer(polOfficer.session))
          .expect(200)
      ).body as QueueItem[];
      expect(police.map((i) => i.id)).not.toContain(id);
      await request(h.http())
        .get(`${api}/review/applications/${id}`)
        .set(bearer(polOfficer.session))
        .expect(403);
      // An officer cannot use supervisor-only actions.
      await post(addrOfficer.session, `/review/applications/${id}/assign`, {
        version: 1,
        officerId: addrOfficer2.session.user.id,
      }).expect(403);
    });

    it('should let only one of two officers claim the same version', async () => {
      const { id } = await queued('PROOF_OF_ADDRESS', addrOfficer);
      const { version } = await staffView(addrOfficer, id);
      const results = await Promise.all([
        post(addrOfficer.session, `/review/applications/${id}/claim`, { version }),
        post(addrOfficer2.session, `/review/applications/${id}/claim`, { version }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const app = await h.prisma.application.findUniqueOrThrow({ where: { id } });
      expect(app.status).toBe('IN_REVIEW');
      expect(app.claimExpiresAt).not.toBeNull();
    });

    it('should mask personal fields and audit an unmask', async () => {
      const { id } = await queued('PROOF_OF_ADDRESS', addrOfficer);
      const app = await claimed(addrOfficer, id);
      expect(app.formData['idNumber']).toBe('••••');
      expect(app.maskedFields).toEqual(
        expect.arrayContaining(['idNumber', 'phone', 'dateOfBirth']),
      );
      expect(JSON.stringify(app)).not.toContain('SO7654321');
      const clear = await post(addrOfficer.session, `/review/applications/${id}/unmask`).expect(
        200,
      );
      expect((clear.body as { formData: Record<string, unknown> }).formData['idNumber']).toBe(
        'SO7654321',
      );
      expect(
        await h.prisma.auditLog.count({
          where: { entityId: id, action: 'APPLICATION_PII_VIEWED' },
        }),
      ).toBe(1);
    });

    it('should return expired claims to the queue and release claims of a deactivated officer', async () => {
      const a = await queued('PROOF_OF_ADDRESS', addrOfficer);
      await claimed(addrOfficer2, a.id);
      await h.prisma.application.update({
        where: { id: a.id },
        data: { claimExpiresAt: new Date(Date.now() - 1000) },
      });
      expect(await h.app.get(ReviewService).expireClaims()).toBeGreaterThanOrEqual(1);
      expect((await h.prisma.application.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
        'QUEUED',
      );

      const leaver = await signUpStaff(h, 'OFFICER', 'ADDRESS');
      const b = await queued('PROOF_OF_ADDRESS', addrOfficer);
      await claimed(leaver, b.id);
      // A second application waits on the citizen: it keeps its status but loses the assignee.
      const c = await queued('PROOF_OF_ADDRESS', addrOfficer);
      const cApp = await claimed(leaver, c.id);
      await post(leaver.session, `/review/applications/${c.id}/corrections`, {
        version: cApp.version,
        items: [{ kind: 'FIELD', target: 'district', comment: 'Check the district' }],
      }).expect(200);
      const caller = {
        id: addrSup.session.user.id,
        role: 'ADMIN' as const,
        departmentId: null,
        departmentCode: null,
        sid: 'test',
      };
      await h.app
        .get(StaffService)
        .deactivate(caller, leaver.session.user.id, { ip: null, userAgent: null, requestId: null });
      const after = await h.prisma.application.findUniqueOrThrow({ where: { id: b.id } });
      expect(after).toMatchObject({ status: 'QUEUED', assigneeId: null });
      const waiting = await h.prisma.application.findUniqueOrThrow({ where: { id: c.id } });
      expect(waiting).toMatchObject({ status: 'CORRECTION_REQUESTED', assigneeId: null });
      expect(
        await h.prisma.auditLog.count({
          where: { entityId: c.id, action: 'APPLICATION_UNASSIGNED' },
        }),
      ).toBe(1);
    });
  });

  describe('proof of address: corrections, approval and certificates', () => {
    it('should run corrections, approve, verify publicly, check the name and revoke', async () => {
      const { session, id } = await queued('PROOF_OF_ADDRESS', addrOfficer);
      let app = await claimed(addrOfficer, id);
      expect(app.allowedActions).toEqual(
        expect.arrayContaining(['APPROVE', 'REQUEST_CORRECTION', 'REJECT']),
      );

      app = (
        await post(addrOfficer.session, `/review/applications/${id}/corrections`, {
          version: app.version,
          items: [
            { kind: 'FIELD', target: 'streetOrLandmark', comment: 'Give a landmark we can find' },
            { kind: 'DOCUMENT', target: 'UTILITY_BILL', comment: 'The bill is not readable' },
          ],
        }).expect(200)
      ).body as StaffApplication;
      expect(app.status).toBe('CORRECTION_REQUESTED');
      const paused = await h.prisma.application.findUniqueOrThrow({ where: { id } });
      expect(paused.slaPausedAt).not.toBeNull();

      let mine = await citizenView(session, id);
      expect(mine.editableFields).toEqual(['streetOrLandmark']);
      expect(mine.allowedActions).toContain('RESUBMIT');
      // Nothing changed yet: both items are reported.
      const unchanged = await post(session, `/applications/${id}/resubmit`).expect(422);
      expect((unchanged.body as ErrorEnvelope).error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'formData.streetOrLandmark' }),
          expect.objectContaining({ path: 'documents.UTILITY_BILL' }),
        ]),
      );
      // Other fields stay locked.
      await request(h.http())
        .patch(`${api}/applications/${id}`)
        .set(bearer(session))
        .send({ formData: { district: 'Wadajir' } })
        .expect(409);
      await request(h.http())
        .patch(`${api}/applications/${id}`)
        .set(bearer(session))
        .send({ formData: { streetOrLandmark: 'Behind the Taleex mosque, blue gate' } })
        .expect(200);
      const bill = await upload(h, session, id, 'UTILITY_BILL', FILES.pdf(4096));
      await waitForDocument(h, bill.ticket.document.id, 'CLEAN');
      mine = (await post(session, `/applications/${id}/resubmit`).expect(200))
        .body as ApplicationDetail;
      expect(mine.status).toBe('IN_REVIEW');
      const resumed = await h.prisma.application.findUniqueOrThrow({ where: { id } });
      expect(resumed).toMatchObject({ assigneeId: addrOfficer.session.user.id, slaPausedAt: null });
      expect(resumed.slaPausedTotalMs).toBeGreaterThan(0n);

      app = await staffView(addrOfficer, id);
      expect(app.approvalBlockers).toEqual([]);
      app = (
        await post(addrOfficer.session, `/review/applications/${id}/approve`, {
          version: app.version,
        }).expect(200)
      ).body as StaffApplication;
      expect(app.status).toBe('ISSUED');
      expect(app.certificate).toMatchObject({
        status: 'VALID',
        holderName: 'Amina Hassan Warsame',
      });
      const certNo = app.certificate!.certificateNo;
      expect(certNo).toMatch(/^ADR-\d{4}-\d{6}$/);

      mine = await citizenView(session, id);
      expect(mine.certificate).toMatchObject({ certificateNo: certNo, status: 'VALID' });
      const pdf = await request(h.http())
        .get(`${api}/certificates/${mine.certificate!.id}/certificate.pdf`)
        .set(bearer(session))
        .expect(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      // Another citizen cannot download it.
      const other = await signUpCitizen(h);
      await request(h.http())
        .get(`${api}/certificates/${mine.certificate!.id}/certificate.pdf`)
        .set(bearer(other.session))
        .expect(404);

      const pub = (await request(h.http()).get(`${api}/verify/c/${certNo}`).expect(200))
        .body as PublicCertificate;
      expect(pub).toMatchObject({ status: 'VALID', holderNameMasked: 'Amina H*** W***' });
      expect(JSON.stringify(pub)).not.toMatch(/SO7654321|Taleex|Warsame/);
      const keys = (await request(h.http()).get(`${api}/verify/keys`).expect(200))
        .body as PublicKeys;
      const row = await h.prisma.certificate.findUniqueOrThrow({
        where: { certificateNo: certNo },
      });
      const sig = new URL(h.app.get(CertificatesService).verifyUrl(row)).hash.replace('#sig=', '');
      const key = keys.keys.find((k) => k.kid === pub.payload.kid)!.publicKey;
      expect(await verifySignature(pub.payload, sig, key)).toBe('VALID');
      expect(await verifySignature({ ...pub.payload, no: 'ADR-2026-999999' }, sig, key)).toBe(
        'INVALID',
      );

      const check = (name: string) =>
        request(h.http()).post(`${api}/verify/c/${certNo}/name-check`).send({ name });
      expect((await check('  amina hassan  WARSAME ').expect(200)).body).toEqual({ match: true });
      expect((await check('Amina Hassan').expect(200)).body).toEqual({ match: false });

      await post(addrOfficer.session, `/certificates/${row.id}/revoke`, {
        reason: 'ERROR',
        note: 'Issued in error',
      }).expect(403);
      await post(addrSup.session, `/certificates/${row.id}/revoke`, {
        reason: 'ERROR',
        note: 'Issued in error',
      }).expect(200);
      const revoked = (await request(h.http()).get(`${api}/verify/c/${certNo}`).expect(200))
        .body as PublicCertificate;
      expect(revoked.status).toBe('REVOKED');
      expect(
        await h.prisma.auditLog.count({
          where: { entityId: row.id, action: 'CERTIFICATE_REVOKED' },
        }),
      ).toBe(1);
    });

    it('should refuse a fourth correction round', async () => {
      const { id } = await queued('PROOF_OF_ADDRESS', addrOfficer);
      const app = await claimed(addrOfficer, id);
      await h.prisma.application.update({ where: { id }, data: { correctionRound: 3 } });
      const res = await post(addrOfficer.session, `/review/applications/${id}/corrections`, {
        version: app.version,
        items: [{ kind: 'FIELD', target: 'district', comment: 'Check the district' }],
      }).expect(409);
      expect((res.body as ErrorEnvelope).error.code).toBe('MAX_CORRECTION_ROUNDS');
    });

    it('should abandon after the correction deadline and send reminders before it', async () => {
      const { id } = await queued('PROOF_OF_ADDRESS', addrOfficer);
      const app = await claimed(addrOfficer, id);
      await post(addrOfficer.session, `/review/applications/${id}/corrections`, {
        version: app.version,
        items: [{ kind: 'FIELD', target: 'district', comment: 'Check the district' }],
      }).expect(200);
      const req = await h.prisma.correctionRequest.findFirstOrThrow({
        where: { applicationId: id },
      });
      await h.prisma.correctionRequest.update({
        where: { id: req.id },
        data: { dueAt: new Date(Date.now() + 12 * 3_600_000) },
      });
      const review = h.app.get(ReviewService);
      await review.processCorrectionDeadlines();
      await review.processCorrectionDeadlines();
      const reminders = await h.prisma.outboxEvent.findMany({
        where: { aggregateId: id, type: 'CORRECTION_DEADLINE_REMINDER' },
      });
      expect(reminders).toHaveLength(2); // 7-day and 1-day, each once
      await h.prisma.application.update({
        where: { id },
        data: { correctionDueAt: new Date(Date.now() - 1000) },
      });
      await review.processCorrectionDeadlines();
      expect((await h.prisma.application.findUniqueOrThrow({ where: { id } })).status).toBe(
        'ABANDONED',
      );
    });

    it('should issue a paid duplicate and supersede on a new application', async () => {
      const { session, id } = await queued('PROOF_OF_ADDRESS', addrOfficer);
      let app = await claimed(addrOfficer, id);
      app = (
        await post(addrOfficer.session, `/review/applications/${id}/approve`, {
          version: app.version,
        }).expect(200)
      ).body as StaffApplication;
      const original = app.certificate!;

      const order = await post(session, `/certificates/${original.id}/duplicates`, {
        copies: 2,
      }).expect(201);
      const dupId = (order.body as { applicationId: string }).applicationId;
      let dup = await citizenView(session, dupId);
      expect(dup).toMatchObject({ kind: 'DUPLICATE', status: 'AWAITING_PAYMENT' });
      await payInFull(session, dup, addrOfficer);
      dup = await citizenView(session, dupId);
      expect(dup.status).toBe('ISSUED');
      expect(dup.certificate!.certificateNo).not.toBe(original.certificateNo);
      const certs = (
        await request(h.http()).get(`${api}/certificates`).set(bearer(session)).expect(200)
      ).body as CertificateSummary[];
      expect(certs.filter((c) => c.isDuplicate)).toHaveLength(1);

      // A new application for the same person supersedes the original and its copy.
      const again = await queued('PROOF_OF_ADDRESS', addrOfficer, session);
      app = await claimed(addrOfficer, again.id);
      await post(addrOfficer.session, `/review/applications/${again.id}/approve`, {
        version: app.version,
      }).expect(200);
      const old = await h.prisma.certificate.findMany({
        where: { id: { in: [original.id, dup.certificate!.id] } },
      });
      expect(old.map((c) => [c.status, c.revokeReason])).toEqual([
        ['REVOKED', 'SUPERSEDED'],
        ['REVOKED', 'SUPERSEDED'],
      ]);
      // Every certificate status change is audited, the copy included.
      const copyAudit = await h.prisma.auditLog.findFirstOrThrow({
        where: { entityId: dup.certificate!.id, action: 'CERTIFICATE_REVOKED' },
      });
      expect(copyAudit.after).toMatchObject({
        reason: 'SUPERSEDED',
        cascadedFrom: original.certificateNo,
      });
      expect(
        await h.prisma.auditLog.count({
          where: { entityId: original.id, action: 'CERTIFICATE_SUPERSEDED' },
        }),
      ).toBe(1);
    });

    it('should block approval on a chargeback until a supervisor resolves it', async () => {
      const { id } = await queued('PROOF_OF_ADDRESS', addrOfficer);
      let app = await claimed(addrOfficer, id);
      await h.prisma.application.update({ where: { id }, data: { chargebackFlag: true } });
      app = await staffView(addrOfficer, id);
      const blocked = await post(addrOfficer.session, `/review/applications/${id}/approve`, {
        version: app.version,
      }).expect(409);
      expect((blocked.body as ErrorEnvelope).error.code).toBe('APPROVAL_BLOCKED');
      await post(addrOfficer.session, `/review/applications/${id}/chargeback`, {
        version: app.version,
        decision: 'KEEP',
        note: 'Payment re-collected',
      }).expect(403);
      app = (
        await post(addrSup.session, `/review/applications/${id}/chargeback`, {
          version: app.version,
          decision: 'KEEP',
          note: 'Payment re-collected',
        }).expect(200)
      ).body as StaffApplication;
      expect(app.chargebackFlag).toBe(false);
      await post(addrOfficer.session, `/review/applications/${id}/approve`, {
        version: app.version,
      }).expect(200);
    });
  });

  describe('birth certificate: second approval', () => {
    it('should forward, refuse the same person, and issue on a different supervisor', async () => {
      const { id } = await queued('BIRTH_CERTIFICATE', civOfficer);
      // A supervisor working the case themselves cannot also give the second approval.
      await claimed(civSupA, id);
      let app = await staffView(civSupA, id);
      const early = await post(civSupA.session, `/review/applications/${id}/approve`, {
        version: app.version,
      }).expect(409);
      expect((early.body as ErrorEnvelope).error.details).toEqual(
        expect.arrayContaining([expect.stringContaining('appointment')]),
      );
      const noNames = await post(civSupA.session, `/review/applications/${id}/appointment`, {
        version: app.version,
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        location: 'Civil registry, Hodan',
      }).expect(200);
      await h.prisma.appointment.updateMany({
        where: { applicationId: id },
        data: { scheduledAt: new Date(Date.now() - 60_000) },
      });
      await post(civSupA.session, `/review/applications/${id}/appointment/outcome`, {
        version: (noNames.body as StaffApplication).version,
        outcome: 'ATTENDED',
      }).expect(422);
      await h.prisma.appointment.deleteMany({ where: { applicationId: id } });
      await h.prisma.application.update({ where: { id }, data: { status: 'IN_REVIEW' } });
      app = await attended(civSupA, id, [
        { name: 'Amina Hassan', role: 'Mother' },
        { name: 'Ali Warsame', role: 'Father' },
      ]);
      app = (
        await post(civSupA.session, `/review/applications/${id}/approve`, {
          version: app.version,
        }).expect(200)
      ).body as StaffApplication;
      expect(app.status).toBe('AWAITING_SUPERVISOR');
      expect(app.certificate).toBeNull();

      await post(civOfficer.session, `/review/applications/${id}/second-approve`, {
        version: app.version,
      }).expect(403);
      const same = await post(civSupA.session, `/review/applications/${id}/second-approve`, {
        version: app.version,
      }).expect(403);
      expect((same.body as ErrorEnvelope).error.code).toBe('SECOND_PERSON_REQUIRED');
      // The database refuses it too.
      await expect(
        h.prisma.reviewDecision.create({
          data: {
            applicationId: id,
            level: 'SUPERVISOR',
            decision: 'APPROVE',
            decidedById: civSupA.session.user.id,
          },
        }),
      ).rejects.toThrow();

      app = (
        await post(civSupB.session, `/review/applications/${id}/second-approve`, {
          version: app.version,
        }).expect(200)
      ).body as StaffApplication;
      expect(app.status).toBe('ISSUED');
      expect(app.certificate).toMatchObject({
        status: 'VALID',
        holderName: 'Hodan Ali Warsame',
        expiresAt: null,
      });
      expect(app.decisions.map((d) => [d.level, d.decision])).toEqual([
        ['OFFICER', 'FORWARD'],
        ['SUPERVISOR', 'APPROVE'],
      ]);
    });
  });

  describe('supervisor oversight', () => {
    it('should reassign work in review and return a forwarded application to the officer', async () => {
      const a = await queued('PROOF_OF_ADDRESS', addrOfficer);
      let app = await claimed(addrOfficer, a.id);
      app = (
        await post(addrSup.session, `/review/applications/${a.id}/assign`, {
          version: app.version,
          officerId: addrOfficer2.session.user.id,
        }).expect(200)
      ).body as StaffApplication;
      expect(app).toMatchObject({ status: 'IN_REVIEW', assigneeId: addrOfficer2.session.user.id });
      expect(
        await h.prisma.auditLog.count({
          where: { entityId: a.id, action: 'APPLICATION_REASSIGNED' },
        }),
      ).toBe(1);

      const b = await queued('BIRTH_CERTIFICATE', civOfficer);
      app = await claimed(civOfficer, b.id);
      app = await attended(civOfficer, b.id, [{ name: 'Amina Hassan', role: 'Mother' }]);
      app = (
        await post(civOfficer.session, `/review/applications/${b.id}/approve`, {
          version: app.version,
        }).expect(200)
      ).body as StaffApplication;
      app = (
        await post(civSupA.session, `/review/applications/${b.id}/return`, {
          version: app.version,
          note: 'Check the father’s ID first',
        }).expect(200)
      ).body as StaffApplication;
      expect(app.status).toBe('IN_REVIEW');
      expect(app.decisions.at(-1)).toMatchObject({ level: 'SUPERVISOR', decision: 'RETURN' });
      expect(
        await h.prisma.auditLog.count({
          where: { entityId: b.id, action: 'APPLICATION_RETURNED' },
        }),
      ).toBe(1);
    });

    it('should hold a paid copy when its original was revoked in the meantime', async () => {
      const { session, id } = await queued('PROOF_OF_ADDRESS', addrOfficer);
      let app = await claimed(addrOfficer, id);
      app = (
        await post(addrOfficer.session, `/review/applications/${id}/approve`, {
          version: app.version,
        }).expect(200)
      ).body as StaffApplication;
      const order = await post(session, `/certificates/${app.certificate!.id}/duplicates`, {
        copies: 1,
      }).expect(201);
      const copyId = (order.body as { applicationId: string }).applicationId;
      await post(addrSup.session, `/certificates/${app.certificate!.id}/revoke`, {
        reason: 'ERROR',
        note: 'Issued in error',
      }).expect(200);
      await payInFull(session, await citizenView(session, copyId), addrOfficer);
      const copy = await citizenView(session, copyId);
      expect(copy.status).toBe('AWAITING_PAYMENT');
      expect(copy.certificate).toBeNull();
      expect(
        await h.prisma.auditLog.count({
          where: { entityId: copyId, action: 'DUPLICATE_SOURCE_NOT_VALID' },
        }),
      ).toBe(1);
    });
  });

  describe('police clearance: referral', () => {
    it('should refer a record found without issuing or exposing the note', async () => {
      const { session, id } = await queued('POLICE_CLEARANCE', polOfficer);
      let app = await claimed(polOfficer, id);
      const tooSoon = await post(polOfficer.session, `/review/applications/${id}/refer`, {
        version: app.version,
        note: 'Conviction 2015 for theft',
      }).expect(409);
      expect((tooSoon.body as ErrorEnvelope).error.code).toBe('APPOINTMENT_REQUIRED');
      app = await attended(polOfficer, id);
      app = (
        await post(polOfficer.session, `/review/applications/${id}/refer`, {
          version: app.version,
          note: 'Conviction 2015 for theft',
        }).expect(200)
      ).body as StaffApplication;
      expect(app.status).toBe('AWAITING_SUPERVISOR');
      expect(app.allowedActions).not.toContain('CONFIRM_REFERRAL'); // officer view
      const sup = await staffView(polSup, id);
      expect(sup.allowedActions).toEqual(expect.arrayContaining(['CONFIRM_REFERRAL', 'RETURN']));
      expect(sup.allowedActions).not.toContain('SECOND_APPROVE');
      await post(polSup.session, `/review/applications/${id}/second-approve`, {
        version: sup.version,
      }).expect(409);
      app = (
        await post(polSup.session, `/review/applications/${id}/confirm-referral`, {
          version: sup.version,
        }).expect(200)
      ).body as StaffApplication;
      expect(app.status).toBe('REFERRED');
      expect(app.certificate).toBeNull();
      expect(JSON.stringify(app)).not.toContain('Conviction');

      const mine = await citizenView(session, id);
      expect(mine.status).toBe('REFERRED');
      expect(JSON.stringify(mine)).not.toContain('Conviction');
      const events = await h.prisma.outboxEvent.findMany({ where: { aggregateId: id } });
      expect(JSON.stringify(events, bigints)).not.toContain('Conviction');
      const audits = await h.prisma.auditLog.findMany({ where: { entityId: id } });
      expect(JSON.stringify(audits, bigints)).not.toContain('Conviction');
      const decision = await h.prisma.reviewDecision.findFirstOrThrow({
        where: { applicationId: id, outcome: 'RECORD_FOUND' },
      });
      expect(decision.note).toBeNull();
      expect(decision.noteEnc).not.toBeNull();
    });

    it('should issue on "no record" after fingerprints and reject with a reason', async () => {
      const a = await queued('POLICE_CLEARANCE', polOfficer);
      let app = await claimed(polOfficer, a.id);
      app = await attended(polOfficer, a.id);
      app = (
        await post(polOfficer.session, `/review/applications/${a.id}/approve`, {
          version: app.version,
        }).expect(200)
      ).body as StaffApplication;
      expect(app).toMatchObject({ status: 'ISSUED' });
      expect(app.certificate!.certificateNo).toMatch(/^POL-/);

      const b = await queued('POLICE_CLEARANCE', polOfficer);
      app = await claimed(polOfficer, b.id);
      await post(polOfficer.session, `/review/applications/${b.id}/reject`, {
        version: app.version,
        reasonCode: 'NOT_A_CODE',
        note: 'Documents do not match',
      }).expect(422);
      app = (
        await post(polOfficer.session, `/review/applications/${b.id}/reject`, {
          version: app.version,
          reasonCode: 'DOCUMENTS_INVALID',
          note: 'Documents do not match',
        }).expect(200)
      ).body as StaffApplication;
      expect(app.status).toBe('REJECTED');
      // No refund on rejection.
      expect(await h.prisma.refund.count({ where: { payment: { applicationId: b.id } } })).toBe(0);
    });
  });
});
