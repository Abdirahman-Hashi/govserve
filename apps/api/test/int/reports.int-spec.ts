import {
  type ApplicationDetail,
  type CollectionsReport,
  type MovementsPage,
  type PaymentDto,
  type PendingWorkReport,
  type ReportApplicationsPage,
  type ReportSummary,
  type VolumesReport,
} from '@govserve/shared';
import request from 'supertest';
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
type Staff = Awaited<ReturnType<typeof signUpStaff>>;
const HOUR = 3_600_000;

describe('Management dashboard (integration)', () => {
  let h: Harness;
  let addrOfficer: Staff;
  let addrSup: Staff;
  let polSup: Staff;
  let admin: Staff;
  let citizenId: string;
  let deptA: string; // address office
  let deptB: string; // police
  const svc: Record<string, { id: string; versionId: string; departmentId: string }> = {};
  let seq = 0;

  async function seedApp(
    service: 'PROOF_OF_ADDRESS' | 'POLICE_CLEARANCE',
    data: Record<string, unknown> = {},
  ) {
    const s = svc[service]!;
    seq += 1;
    return h.prisma.application.create({
      data: {
        referenceNo: `GS-2025-${String(500000 + seq)}`,
        applicantId: citizenId,
        serviceId: s.id,
        serviceVersionId: s.versionId,
        departmentId: s.departmentId,
        status: 'QUEUED',
        submittedAt: new Date(),
        ...data,
      },
    });
  }

  /** Ledger rows exactly as MoneyStateService writes them (status + payment_event per transition). */
  async function seedPayment(
    appId: string,
    amountCents: bigint,
    channel: 'CARD' | 'CASH' | 'BANK' | 'MOBILE_MONEY',
    opts: {
      confirmed?: boolean;
      reversed?: boolean;
      refunds?: [bigint, 'COMPLETED' | 'REQUESTED' | 'DECLINED'][];
    } = {},
  ) {
    seq += 1;
    const confirmed = opts.confirmed ?? true;
    const status = !confirmed ? 'PENDING_VERIFICATION' : opts.reversed ? 'REVERSED' : 'CONFIRMED';
    const p = await h.prisma.payment.create({
      data: {
        applicationId: appId,
        channel,
        provider: 'TEST',
        reference: `TX-RPT-${seq}`,
        referenceNorm: `TXRPT${seq}`,
        amountCents,
        paidAt: new Date(),
        status,
      },
    });
    if (confirmed) {
      await h.prisma.paymentEvent.create({
        data: {
          paymentId: p.id,
          type: 'PAYMENT_CONFIRMED',
          fromStatus: 'PENDING_VERIFICATION',
          toStatus: 'CONFIRMED',
        },
      });
    }
    if (opts.reversed) {
      await h.prisma.paymentEvent.create({
        data: {
          paymentId: p.id,
          type: 'PAYMENT_REVERSED',
          fromStatus: 'CONFIRMED',
          toStatus: 'REVERSED',
        },
      });
    }
    for (const [amount, rstatus] of opts.refunds ?? []) {
      const r = await h.prisma.refund.create({
        data: { paymentId: p.id, reason: 'OVERPAYMENT', amountCents: amount, status: rstatus },
      });
      if (rstatus === 'COMPLETED') {
        await h.prisma.paymentEvent.create({
          data: {
            paymentId: p.id,
            type: 'REFUND_COMPLETED',
            payload: { refundId: r.id, from: 'APPROVED', to: 'COMPLETED' },
          },
        });
      }
    }
    return p;
  }

  /** Ground truth straight from the transaction tables, not the views. */
  async function truth(departmentId?: string) {
    const dept = departmentId ? `AND a."departmentId" = '${departmentId}'` : '';
    const [row] = await h.prisma.$queryRawUnsafe<
      { confirmedNow: string; everConfirmed: string; reversed: string; refunds: string }[]
    >(`
      SELECT
        COALESCE(SUM(p."amountCents") FILTER (WHERE p."status" = 'CONFIRMED'), 0)::text AS "confirmedNow",
        COALESCE(SUM(p."amountCents") FILTER (WHERE p."status" IN ('CONFIRMED', 'REVERSED')), 0)::text AS "everConfirmed",
        COALESCE(SUM(p."amountCents") FILTER (WHERE p."status" = 'REVERSED'), 0)::text AS "reversed",
        (SELECT COALESCE(SUM(r."amountCents"), 0) FROM "refund" r JOIN "payment" p2 ON p2."id" = r."paymentId"
           JOIN "application" a2 ON a2."id" = p2."applicationId"
           WHERE r."status" = 'COMPLETED' ${dept.replace('a.', 'a2.')})::text AS "refunds"
      FROM "payment" p JOIN "application" a ON a."id" = p."applicationId" WHERE TRUE ${dept}`);
    return {
      // Both identities must hold, to the cent.
      netA: BigInt(row!.confirmedNow) - BigInt(row!.refunds),
      netB: BigInt(row!.everConfirmed) - BigInt(row!.refunds) - BigInt(row!.reversed),
      everConfirmed: row!.everConfirmed,
      refunds: row!.refunds,
      reversed: row!.reversed,
    };
  }

  const get = <T>(who: Staff, path: string, query: Record<string, string> = {}) =>
    request(h.http())
      .get(`${api}/reports/${path}`)
      .query(query)
      .set(bearer(who.session))
      .expect(200)
      .then((r) => r.body as T);

  beforeAll(async () => {
    h = await startHarness();
    [addrOfficer, addrSup, polSup, admin] = [
      await signUpStaff(h, 'OFFICER', 'ADDRESS'),
      await signUpStaff(h, 'SUPERVISOR', 'ADDRESS'),
      await signUpStaff(h, 'SUPERVISOR', 'POLICE'),
      await signUpStaff(h, 'ADMIN', null),
    ];
    for (const code of ['PROOF_OF_ADDRESS', 'POLICE_CLEARANCE'] as const) {
      const s = await h.prisma.service.findUniqueOrThrow({
        where: { code },
        include: { versions: { where: { status: 'PUBLISHED' } } },
      });
      svc[code] = { id: s.id, versionId: s.versions[0]!.id, departmentId: s.departmentId };
    }
    deptA = svc['PROOF_OF_ADDRESS']!.departmentId;
    deptB = svc['POLICE_CLEARANCE']!.departmentId;

    // 1. A real payment through the API: mobile money reported by the citizen, confirmed by an officer.
    const citizen = await signUpCitizen(h);
    citizenId = citizen.session.user.id;
    const app = (
      await request(h.http())
        .post(`${api}/applications`)
        .set(bearer(citizen.session))
        .send({ serviceCode: 'PROOF_OF_ADDRESS' })
    ).body as ApplicationDetail;
    await request(h.http())
      .patch(`${api}/applications/${app.id}`)
      .set(bearer(citizen.session))
      .send({
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
      })
      .expect(200);
    for (const docType of ['NATIONAL_ID_OR_PASSPORT', 'UTILITY_BILL']) {
      const u = await upload(h, citizen.session, app.id, docType, FILES.pdf());
      await waitForDocument(h, u.ticket.document.id, 'CLEAN');
    }
    const submitted = (
      await request(h.http())
        .post(`${api}/applications/${app.id}/submit`)
        .set(bearer(citizen.session))
        .expect(200)
    ).body as ApplicationDetail;
    const paid = (
      await request(h.http())
        .post(`${api}/applications/${app.id}/payments`)
        .set(bearer(citizen.session))
        .send({
          channel: 'MOBILE_MONEY',
          provider: 'EVC_PLUS',
          reference: `TXREAL${Date.now()}`,
          amountCents: submitted.feeAssessment!.totalCents,
          paidAt: '2026-10-13',
        })
        .expect(201)
    ).body as PaymentDto;
    await request(h.http())
      .post(`${api}/staff/payments/${paid.id}/confirm`)
      .set(bearer(addrOfficer.session))
      .expect(200);

    // 2. Ledger rows: card, cash and bank, a reversal, refunds in every state, an unconfirmed payment.
    const a1 = await seedApp('PROOF_OF_ADDRESS');
    await seedPayment(a1.id, 1_234n, 'CARD', {
      refunds: [
        [234n, 'COMPLETED'],
        [100n, 'REQUESTED'],
        [50n, 'DECLINED'],
      ],
    });
    await seedPayment(a1.id, 999n, 'CARD', { reversed: true });
    await seedPayment(a1.id, 777n, 'BANK', { confirmed: false });
    const b1 = await seedApp('POLICE_CLEARANCE');
    await seedPayment(b1.id, 1_500n, 'CASH', { refunds: [[1n, 'COMPLETED']] });
    await seedPayment(b1.id, 2_000n, 'MOBILE_MONEY');
  });

  afterAll(async () => {
    await h?.close();
  });

  describe('reconciliation (to the cent)', () => {
    it('should equal confirmed minus completed refunds minus reversals for each scope', async () => {
      for (const [who, dept] of [
        [addrSup, deptA],
        [polSup, deptB],
        [admin, undefined],
      ] as const) {
        const t = await truth(dept);
        expect(t.netA).toBe(t.netB);
        const s = await get<ReportSummary>(who, 'summary');
        expect(s.collections).toEqual({
          confirmedCents: t.everConfirmed,
          refundedCents: t.refunds,
          reversedCents: t.reversed,
          netCents: t.netA.toString(),
        });
        // Every breakdown and the drill-down add up to the same totals.
        for (const groupBy of ['day', 'service', 'channel']) {
          const c = await get<CollectionsReport>(who, 'collections', { groupBy });
          expect(c.totals.netCents).toBe(t.netA.toString());
          expect(c.rows.reduce((sum, r) => sum + BigInt(r.netCents), 0n)).toBe(t.netA);
        }
        let net = 0n;
        let cursor: string | null = null;
        do {
          const m: MovementsPage = await get<MovementsPage>(
            who,
            'movements',
            cursor ? { cursor } : {},
          );
          net += m.items.reduce(
            (sum, i) => sum + (i.kind === 'CONFIRMED' ? 1n : -1n) * BigInt(i.amountCents),
            0n,
          );
          cursor = m.nextCursor;
        } while (cursor);
        expect(net).toBe(t.netA);
      }
    });

    it('should know the exact figures seeded for the police department', async () => {
      const s = await get<ReportSummary>(polSup, 'summary');
      expect(s.collections).toEqual({
        confirmedCents: '3500',
        refundedCents: '1',
        reversedCents: '0',
        netCents: '3499',
      });
      const byChannel = await get<CollectionsReport>(polSup, 'collections', { groupBy: 'channel' });
      // Channels come in enum order; compare as a set.
      expect(byChannel.rows.map((r) => [r.key, r.netCents]).sort()).toEqual([
        ['CASH', '1499'],
        ['MOBILE_MONEY', '2000'],
      ]);
      const cash = await get<ReportSummary>(polSup, 'summary', { channel: 'CASH' });
      expect(cash.collections.netCents).toBe('1499');
    });
  });

  describe('scoping', () => {
    it('should keep a supervisor to their department even when another is requested', async () => {
      const own = await get<ReportSummary>(polSup, 'summary');
      const asked = await get<ReportSummary>(polSup, 'summary', { departmentId: deptA });
      expect(asked.scope.departmentId).toBe(deptB);
      expect(asked.collections).toEqual(own.collections);
      const movements = await get<MovementsPage>(polSup, 'movements', { departmentId: deptA });
      expect(movements.items.every((i) => i.serviceName.startsWith('Police'))).toBe(true);
    });

    it('should let an admin pick a department', async () => {
      const b = await get<ReportSummary>(admin, 'summary', { departmentId: deptB });
      expect(b.collections.netCents).toBe('3499');
      expect(b.scope.departmentId).toBe(deptB);
    });

    it('should refuse officers and citizens', async () => {
      await request(h.http())
        .get(`${api}/reports/summary`)
        .set(bearer(addrOfficer.session))
        .expect(403);
      const citizen = await signUpCitizen(h);
      await request(h.http())
        .get(`${api}/reports/summary`)
        .set(bearer(citizen.session))
        .expect(403);
      await request(h.http())
        .get(`${api}/reports/export/movements.csv`)
        .set(bearer(addrOfficer.session))
        .expect(403);
    });
  });

  describe('volumes, processing time, SLA and pending work', () => {
    it('should compute the application metrics from seeded facts', async () => {
      const now = Date.now();
      // Five decisions taking 10, 20, 30, 40 and 50 hours; the last two missed their SLA.
      for (const [i, hours] of [10, 20, 30, 40, 50].entries()) {
        const submittedAt = new Date(now - 60 * HOUR);
        const decidedAt = new Date(submittedAt.getTime() + hours * HOUR);
        await seedApp('POLICE_CLEARANCE', {
          status: i % 2 ? 'REJECTED' : 'ISSUED',
          submittedAt,
          decidedAt,
          slaDueAt: new Date(submittedAt.getTime() + 35 * HOUR),
        });
      }
      // Overdue now (not paused) vs paused (not overdue).
      await seedApp('POLICE_CLEARANCE', {
        status: 'QUEUED',
        queuedAt: new Date(now - 100 * HOUR),
        slaDueAt: new Date(now - HOUR),
      });
      await seedApp('POLICE_CLEARANCE', {
        status: 'IN_REVIEW',
        slaDueAt: new Date(now - HOUR),
        slaPausedAt: new Date(now - 2 * HOUR),
        assigneeId: polSup.session.user.id,
        queuedAt: new Date(now - 80 * HOUR),
      });
      // Awaiting payment: $15.00 assessed, $5.00 paid → $10.00 outstanding.
      const owing = await seedApp('POLICE_CLEARANCE', { status: 'AWAITING_PAYMENT' });
      await h.prisma.feeAssessment.create({
        data: { applicationId: owing.id, lines: [], totalCents: 1_500n, ruleSnapshot: {} },
      });
      await seedPayment(owing.id, 500n, 'CASH');

      const s = await get<ReportSummary>(polSup, 'summary');
      expect(s.processing).toEqual({ decided: 5, medianHours: 30, p90Hours: 46 });
      expect(s.sla).toEqual({ measured: 5, onTime: 3, compliancePct: 60, overdue: 1 });
      expect(s.outstandingCents).toBe('1000');
      expect(s.byStatus).toEqual(
        expect.arrayContaining([
          { status: 'ISSUED', count: 3 },
          { status: 'REJECTED', count: 2 },
          { status: 'AWAITING_PAYMENT', count: 1 },
        ]),
      );
      const volumes = await get<VolumesReport>(polSup, 'volumes');
      expect(volumes.weeks.reduce((n, w) => n + w.completed, 0)).toBe(5);
      expect(volumes.weeks.reduce((n, w) => n + w.submitted, 0)).toBe(
        s.byStatus.reduce((n, b) => n + b.count, 0),
      );

      // Drill-downs match their KPIs.
      const overdue = await get<ReportApplicationsPage>(polSup, 'applications', {
        view: 'overdue',
      });
      expect(overdue.items).toHaveLength(1);
      const outstanding = await get<ReportApplicationsPage>(polSup, 'applications', {
        view: 'outstanding',
      });
      expect(outstanding.items.map((i) => i.outstandingCents)).toEqual(['1000']);

      const pending = await get<PendingWorkReport>(polSup, 'pending-work');
      expect(pending.departments).toHaveLength(1);
      expect(pending.departments[0]).toMatchObject({ departmentId: deptB, overdue: 1 });
      expect(pending.departments[0]!.queued).toBeGreaterThanOrEqual(2);
      const me = pending.officers.find((o) => o.officerId === polSup.session.user.id)!;
      expect(me.assigned).toBe(1);
      expect(me.oldestSince).not.toBeNull();
      // The address supervisor sees none of it.
      const other = await get<ReportSummary>(addrSup, 'summary');
      expect(other.processing.decided).toBe(0);
      expect(other.outstandingCents).toBe('0');
    });
  });

  describe('CSV export', () => {
    const csv = (who: Staff, dataset: string, query: Record<string, string> = {}) =>
      request(h.http())
        .get(`${api}/reports/export/${dataset}.csv`)
        .query(query)
        .set(bearer(who.session))
        .buffer(true)
        .parse((res, cb) => {
          let data = '';
          res.on('data', (c: Buffer) => (data += c.toString('utf8')));
          res.on('end', () => cb(null, data));
        })
        .expect(200);

    it('should export collections in cents with a reconciling total, and audit it', async () => {
      const res = await csv(polSup, 'collections');
      const lines = (res.body as string)
        .replace(/^\uFEFF/, '')
        .trim()
        .split('\r\n');
      expect(lines[0]).toBe(
        'Group,Key,Confirmed (cents),Refunded (cents),Reversed (cents),Net (cents)',
      );
      const t = await truth(deptB);
      expect(lines.at(-1)).toBe(`total,,${t.everConfirmed},${t.refunds},${t.reversed},${t.netA}`);
      const audit = await h.prisma.auditLog.findFirstOrThrow({
        where: { action: 'REPORT_EXPORTED', actorId: polSup.session.user.id },
      });
      expect(audit.after).toMatchObject({
        dataset: 'collections',
        filters: { departmentId: deptB },
      });
    });

    it('should export the movements drill-down', async () => {
      const res = await csv(admin, 'movements', { kind: 'REFUNDED' });
      const rows = (res.body as string).trim().split('\r\n').slice(1);
      expect(rows.map((r) => r.split(',').at(-1))).toEqual(expect.arrayContaining(['234', '1']));
      expect(rows).toHaveLength(2);
    });
  });
});
