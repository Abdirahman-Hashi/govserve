import {
  type ApplicationPage,
  type AuthSession,
  type PaymentHistoryPage,
  type StaffApplicationResults,
  type StaffPaymentResults,
} from '@govserve/shared';
import request from 'supertest';
import { type ErrorEnvelope } from '../../src/common/filters/error-envelope.filter';
import { CryptoService } from '../../src/crypto/crypto.service';
import { bearer, type Harness, signUpCitizen, signUpStaff, startHarness } from './harness';

const api = '/api/v1';
type Staff = Awaited<ReturnType<typeof signUpStaff>>;
type Citizen = Awaited<ReturnType<typeof signUpCitizen>>;

let seq = 0;
const next = () => (seq += 1);

describe('Search and history (integration)', () => {
  let h: Harness;
  let crypto: CryptoService;
  let addrOfficer: Staff;
  let addrSup: Staff;
  let polOfficer: Staff;
  let amina: Citizen;
  let cabdi: Citizen;
  let keyId: string;
  const services: Record<string, { id: string; versionId: string; departmentId: string }> = {};

  /** Seeds an application row (and its data) directly: search reads the database only. */
  async function seedApp(opts: {
    service: 'PROOF_OF_ADDRESS' | 'POLICE_CLEARANCE';
    applicant: Citizen;
    status?: 'DRAFT' | 'QUEUED' | 'IN_REVIEW' | 'ISSUED' | 'REJECTED';
    createdAt?: Date;
    subjectName?: string;
    subjectNationalId?: string;
  }) {
    const svc = services[opts.service]!;
    const n = next();
    const status = opts.status ?? 'QUEUED';
    return h.prisma.application.create({
      data: {
        referenceNo: status === 'DRAFT' ? null : `GS-2025-${String(900000 + n)}`,
        applicantId: opts.applicant.session.user.id,
        serviceId: svc.id,
        serviceVersionId: svc.versionId,
        departmentId: svc.departmentId,
        status,
        ...(status !== 'DRAFT' && { submittedAt: opts.createdAt ?? new Date() }),
        ...(opts.createdAt && { createdAt: opts.createdAt }),
        data: {
          create: {
            data: {},
            subjectFullName: opts.subjectName ?? 'Amina Hassan',
            subjectNationalIdBidx: opts.subjectNationalId
              ? crypto.blindIndex('nationalId', opts.subjectNationalId)
              : null,
          },
        },
      },
    });
  }

  async function seedPayment(
    appId: string,
    amountCents: bigint,
    channel: 'MOBILE_MONEY' | 'CASH',
    withReceipt: boolean,
  ) {
    const n = next();
    const payment = await h.prisma.payment.create({
      data: {
        applicationId: appId,
        channel,
        provider: channel === 'CASH' ? 'CASH_DESK' : 'EVC_PLUS',
        reference: `TX-SEARCH-${n}`,
        referenceNorm: `TXSEARCH${n}`,
        amountCents,
        paidAt: new Date(),
        status: withReceipt ? 'CONFIRMED' : 'PENDING_VERIFICATION',
      },
    });
    const receiptNo = withReceipt ? `R-2025-${String(800000 + n)}` : null;
    if (receiptNo) {
      await h.prisma.receipt.create({
        data: {
          receiptNo,
          paymentId: payment.id,
          applicationId: appId,
          amountCents,
          issuedAt: new Date(),
          payloadJson: {},
          signature: Buffer.from('sig'),
          keyId,
        },
      });
    }
    return { payment, receiptNo };
  }

  const staffSearch = (who: Staff, query: Record<string, string>) =>
    request(h.http()).post(`${api}/search/applications`).send(query).set(bearer(who.session));
  const ids = (res: { body: unknown }) =>
    (res.body as StaffApplicationResults).items.map((i) => i.id);

  beforeAll(async () => {
    h = await startHarness();
    crypto = h.app.get(CryptoService);
    [addrOfficer, addrSup, polOfficer] = [
      await signUpStaff(h, 'OFFICER', 'ADDRESS'),
      await signUpStaff(h, 'SUPERVISOR', 'ADDRESS'),
      await signUpStaff(h, 'OFFICER', 'POLICE'),
    ];
    [amina, cabdi] = [await signUpCitizen(h), await signUpCitizen(h)];
    // Distinct identities for name, phone and national ID searches.
    await h.prisma.user.update({
      where: { id: cabdi.session.user.id },
      data: {
        fullName: 'Cabdi Xasan Faarax',
        phoneBidx: crypto.blindIndex('phone', '+252 61 777 0001'),
      },
    });
    await h.prisma.citizenProfile.upsert({
      where: { userId: cabdi.session.user.id },
      create: {
        userId: cabdi.session.user.id,
        nationalIdBidx: crypto.blindIndex('nationalId', 'SO5550001'),
      },
      update: { nationalIdBidx: crypto.blindIndex('nationalId', 'SO5550001') },
    });
    for (const code of ['PROOF_OF_ADDRESS', 'POLICE_CLEARANCE'] as const) {
      const svc = await h.prisma.service.findUniqueOrThrow({
        where: { code },
        include: { versions: { where: { status: 'PUBLISHED' } } },
      });
      services[code] = {
        id: svc.id,
        versionId: svc.versions[0]!.id,
        departmentId: svc.departmentId,
      };
    }
    keyId = (await h.prisma.signingKey.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    await h?.close();
  });

  describe('scope (no leakage across departments)', () => {
    it('should find a police record only for police staff, by every criterion', async () => {
      const app = await seedApp({
        service: 'POLICE_CLEARANCE',
        applicant: cabdi,
        subjectName: 'Cabdi Xasan Faarax',
        subjectNationalId: 'SO5550001',
      });
      const { receiptNo } = await seedPayment(app.id, 1500n, 'MOBILE_MONEY', true);
      const certNo = `POL-2025-${String(700000 + next())}`;
      await h.prisma.certificate.create({
        data: {
          certificateNo: certNo,
          applicationId: app.id,
          serviceId: app.serviceId,
          holderUserId: cabdi.session.user.id,
          subjectKey: cabdi.session.user.id,
          holderName: 'Cabdi Xasan Faarax',
          holderNameMasked: 'Cabdi X*** F***',
          issuedAt: new Date(),
          payloadJson: {},
          signature: Buffer.from('sig'),
          keyId,
        },
      });
      const criteria: Record<string, string>[] = [
        { referenceNo: app.referenceNo!.slice(-6) },
        { receiptNo: receiptNo! },
        { certificateNo: certNo },
        { name: 'faarax cabdi' },
        { nationalId: 'so 555 0001' },
        { phone: '+252617770001' },
      ];
      for (const query of criteria) {
        expect(ids(await staffSearch(polOfficer, query).expect(200))).toContain(app.id);
        expect(ids(await staffSearch(addrOfficer, query).expect(200))).not.toContain(app.id);
      }
      const payments = (
        await request(h.http())
          .post(`${api}/search/payments`)
          .send({ receiptNo: receiptNo! })
          .set(bearer(addrOfficer.session))
          .expect(200)
      ).body as StaffPaymentResults;
      expect(payments.items).toHaveLength(0);
    });

    it('should show citizens only their own applications and payments, and refuse staff search to them', async () => {
      const mine = await seedApp({
        service: 'PROOF_OF_ADDRESS',
        applicant: amina,
        status: 'DRAFT',
      });
      const theirs = await seedApp({ service: 'PROOF_OF_ADDRESS', applicant: cabdi });
      await seedPayment(theirs.id, 1000n, 'CASH', true);
      const list = (
        await request(h.http()).get(`${api}/applications`).set(bearer(amina.session)).expect(200)
      ).body as ApplicationPage;
      expect(list.items.map((i) => i.id)).toContain(mine.id);
      expect(list.items.map((i) => i.id)).not.toContain(theirs.id);
      const pays = (
        await request(h.http()).get(`${api}/payments`).set(bearer(amina.session)).expect(200)
      ).body as PaymentHistoryPage;
      expect(pays.items.every((p) => p.applicationId !== theirs.id)).toBe(true);
      await staffSearch({ session: amina.session } as Staff, {}).expect(403);
      // Drafts never appear in staff search.
      expect(ids(await staffSearch(addrOfficer, { name: 'amina' }).expect(200))).not.toContain(
        mine.id,
      );
    });
  });

  describe('filters', () => {
    it('should filter applications by status, service, dates and partial reference', async () => {
      const old = await seedApp({
        service: 'PROOF_OF_ADDRESS',
        applicant: amina,
        status: 'ISSUED',
        createdAt: new Date('2025-03-10T09:00:00Z'),
      });
      const recent = await seedApp({
        service: 'PROOF_OF_ADDRESS',
        applicant: amina,
        status: 'REJECTED',
        createdAt: new Date('2025-06-10T09:00:00Z'),
      });
      const march = ids(
        await staffSearch(addrOfficer, { from: '2025-03-01', to: '2025-03-31' }).expect(200),
      );
      expect(march).toContain(old.id);
      expect(march).not.toContain(recent.id);
      expect(ids(await staffSearch(addrOfficer, { status: 'REJECTED' }).expect(200))).toContain(
        recent.id,
      );
      expect(ids(await staffSearch(addrOfficer, { status: 'REJECTED' }).expect(200))).not.toContain(
        old.id,
      );
      expect(
        ids(await staffSearch(addrOfficer, { service: 'POLICE_CLEARANCE' }).expect(200)),
      ).toEqual([]);
      const citizen = (
        await request(h.http())
          .get(`${api}/applications`)
          .query({ q: old.referenceNo!.slice(-6) })
          .set(bearer(amina.session))
          .expect(200)
      ).body as ApplicationPage;
      expect(citizen.items.map((i) => i.id)).toEqual([old.id]);
      const bad = await staffSearch(addrOfficer, { from: '2025-04-01', to: '2025-03-01' }).expect(
        422,
      );
      expect((bad.body as ErrorEnvelope).error.code).toBe('VALIDATION_FAILED');
    });

    it('should filter payments by channel, status and amount range in integer cents', async () => {
      const app = await seedApp({ service: 'PROOF_OF_ADDRESS', applicant: amina });
      const small = await seedPayment(app.id, 999n, 'CASH', true);
      const big = await seedPayment(app.id, 12_345n, 'MOBILE_MONEY', false);
      const search = async (query: Record<string, string>) =>
        (
          (
            await request(h.http())
              .post(`${api}/search/payments`)
              .send({ referenceNo: app.referenceNo!, ...query })
              .set(bearer(addrOfficer.session))
              .expect(200)
          ).body as StaffPaymentResults
        ).items.map((p) => p.id);
      expect(await search({ minCents: '1000' })).toEqual([big.payment.id]);
      expect(await search({ maxCents: '999' })).toEqual([small.payment.id]);
      expect(await search({ channel: 'CASH' })).toEqual([small.payment.id]);
      expect(await search({ status: 'PENDING_VERIFICATION' })).toEqual([big.payment.id]);
      await request(h.http())
        .post(`${api}/search/payments`)
        .send({ minCents: '12.5' })
        .set(bearer(addrOfficer.session))
        .expect(422);
    });
  });

  describe('keyset pagination', () => {
    it('should page through ties and concurrent inserts without duplicates or gaps', async () => {
      const at = new Date('2025-09-01T10:00:00Z');
      const seeded = new Set<string>();
      for (let i = 0; i < 60; i++) {
        seeded.add(
          (
            await seedApp({
              service: 'PROOF_OF_ADDRESS',
              applicant: amina,
              createdAt: at,
              subjectName: 'Pagina Test',
            })
          ).id,
        );
      }
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const res = (
          await staffSearch(addrOfficer, { name: 'pagina', ...(cursor && { cursor }) }).expect(200)
        ).body as StaffApplicationResults;
        seen.push(...res.items.map((i) => i.id));
        cursor = res.nextCursor ?? undefined;
        pages += 1;
        // A new application arrives while the officer is paging: it sorts before the cursor.
        if (pages === 1)
          await seedApp({
            service: 'PROOF_OF_ADDRESS',
            applicant: amina,
            subjectName: 'Pagina Late',
          });
      } while (cursor);
      expect(pages).toBe(3);
      expect(new Set(seen).size).toBe(seen.length);
      expect(new Set(seen)).toEqual(seeded);
    });

    it('should refuse a tampered cursor', async () => {
      const res = await staffSearch(addrOfficer, {
        cursor: Buffer.from('nonsense|1').toString('base64url'),
      }).expect(400);
      expect((res.body as ErrorEnvelope).error.code).toBe('INVALID_CURSOR');
    });
  });

  describe('CSV export', () => {
    const exportCsv = (who: AuthSession, query: Record<string, string>) =>
      request(h.http())
        .post(`${api}/search/applications.csv`)
        .send(query)
        .set(bearer(who))
        .buffer(true)
        .parse((res, cb) => {
          let data = '';
          res.on('data', (c: Buffer) => (data += c.toString('utf8')));
          res.on('end', () => cb(null, data));
        });

    it('should refuse officers', async () => {
      await exportCsv(addrOfficer.session, {}).expect(403);
    });

    it('should stream at most the cap, neutralise formulas, stay in scope and be audited', async () => {
      for (let i = 0; i < 9; i++) {
        await seedApp({
          service: 'PROOF_OF_ADDRESS',
          applicant: amina,
          subjectName: '=HYPERLINK("http://x") Exporta',
        });
      }
      await seedApp({
        service: 'POLICE_CLEARANCE',
        applicant: amina,
        subjectName: 'Exporta Police',
      });
      const res = await exportCsv(addrSup.session, { name: 'exporta' }).expect(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toMatch(
        /attachment; filename="govserve-applications-/,
      );
      const lines = (res.body as string)
        .replace(/^\uFEFF/, '')
        .trim()
        .split('\r\n');
      expect(lines[0]).toBe(
        'Reference,Service,Applicant,Subject,Status,Assigned to,Started,Submitted,Decided',
      );
      expect(lines).toHaveLength(1 + 7 + 1); // header + SEARCH_EXPORT_CAP (7) + notice
      expect(lines[8]).toContain('Export stopped at 7 rows');
      expect(lines.slice(1, 8).every((l) => l.includes(`"'=HYPERLINK`))).toBe(true);
      expect(res.body as string).not.toContain('Exporta Police');
      const audit = await h.prisma.auditLog.findFirstOrThrow({
        where: { action: 'SEARCH_EXPORTED', actorId: addrSup.session.user.id },
        orderBy: { id: 'desc' },
      });
      expect(audit.after).toMatchObject({
        kind: 'applications',
        filters: { name: 'provided' },
        cap: 7,
      });
      expect(JSON.stringify(audit.after)).not.toContain('exporta');
    });

    it('should export payments with amounts in cents', async () => {
      const app = await seedApp({ service: 'PROOF_OF_ADDRESS', applicant: amina });
      const { receiptNo } = await seedPayment(app.id, 4321n, 'CASH', true);
      const res = await request(h.http())
        .post(`${api}/search/payments.csv`)
        .send({ receiptNo: receiptNo! })
        .set(bearer(addrSup.session))
        .buffer(true)
        .parse((r, cb) => {
          let data = '';
          r.on('data', (c: Buffer) => (data += c.toString('utf8')));
          r.on('end', () => cb(null, data));
        })
        .expect(200);
      const rows = (res.body as string).trim().split('\r\n');
      expect(rows).toHaveLength(2);
      expect(rows[1]).toContain(`${receiptNo},${app.referenceNo}`);
      expect(rows[1]).toContain(',4321,CONFIRMED,');
    });
  });
});
