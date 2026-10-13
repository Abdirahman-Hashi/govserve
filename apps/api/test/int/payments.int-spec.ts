import { createHash } from 'node:crypto';
import {
  type ApplicationDetail,
  type AuthSession,
  type CardCheckout,
  type PaymentDto,
  type PublicKeys,
  type PublicReceipt,
  type RefundDto,
  type StaffPaymentDto,
  verifySignature,
} from '@govserve/shared';
import request from 'supertest';
import { type ErrorEnvelope } from '../../src/common/filters/error-envelope.filter';
import { PaymentsService } from '../../src/payments/payments.service';
import { signWebhook, SIGNATURE_HEADER } from '../../src/payments/webhook-signature';
import { ReceiptsService } from '../../src/receipts/receipts.service';
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
  fullName: 'Amina Hassan Warsame',
  dateOfBirth: '1990-04-12',
  placeOfBirth: 'Mogadishu',
  idNumber: 'SO1234567',
  mothersFullName: 'Halima Yusuf',
  currentAddress: 'Hodan district, near the market',
  purpose: 'EMPLOYMENT',
};

let refCounter = 0;
const txRef = () => `TX${Date.now()}${(refCounter += 1)}`;

describe('Payments, refunds and receipts (integration)', () => {
  let h: Harness;
  let officer: Awaited<ReturnType<typeof signUpStaff>>;
  let officer2: Awaited<ReturnType<typeof signUpStaff>>;
  let supA: Awaited<ReturnType<typeof signUpStaff>>;
  let supB: Awaited<ReturnType<typeof signUpStaff>>;

  beforeAll(async () => {
    h = await startHarness();
    [officer, officer2, supA, supB] = [
      await signUpStaff(h, 'OFFICER', 'POLICE'),
      await signUpStaff(h, 'OFFICER', 'POLICE'),
      await signUpStaff(h, 'SUPERVISOR', 'POLICE'),
      await signUpStaff(h, 'SUPERVISOR', 'POLICE'),
    ];
  });

  afterAll(async () => {
    await h?.close();
  });

  /** A submitted police clearance ($15.00 + copies × $2.00) awaiting payment. */
  async function submitted(
    extraCopies = 2,
  ): Promise<{ session: AuthSession; app: ApplicationDetail }> {
    const { session } = await signUpCitizen(h);
    const app = (
      await request(h.http())
        .post(`${api}/applications`)
        .set(bearer(session))
        .send({ serviceCode: 'POLICE_CLEARANCE' })
    ).body as ApplicationDetail;
    await request(h.http())
      .patch(`${api}/applications/${app.id}`)
      .set(bearer(session))
      .send({ formData: POLICE_ANSWERS, extraCopies })
      .expect(200);
    const a = await upload(h, session, app.id, 'NATIONAL_ID_OR_PASSPORT', FILES.pdf());
    const b = await upload(h, session, app.id, 'PASSPORT_PHOTO', FILES.jpeg(), {
      mime: 'image/jpeg',
      fileName: 'me.jpg',
    });
    await waitForDocument(h, a.ticket.document.id, 'CLEAN');
    await waitForDocument(h, b.ticket.document.id, 'CLEAN');
    const res = await request(h.http())
      .post(`${api}/applications/${app.id}/submit`)
      .set(bearer(session))
      .expect(200);
    return { session, app: res.body as ApplicationDetail };
  }

  const pay = (
    session: AuthSession,
    appId: string,
    amountCents: string,
    reference = txRef(),
    extra: object = {},
  ) =>
    request(h.http())
      .post(`${api}/applications/${appId}/payments`)
      .set(bearer(session))
      .send({
        channel: 'MOBILE_MONEY',
        provider: 'EVC_PLUS',
        reference,
        amountCents,
        paidAt: '2026-10-13',
        ...extra,
      });
  const confirm = (who: AuthSession, paymentId: string) =>
    request(h.http()).post(`${api}/staff/payments/${paymentId}/confirm`).set(bearer(who));
  const detail = async (session: AuthSession, id: string) =>
    (await request(h.http()).get(`${api}/applications/${id}`).set(bearer(session)).expect(200))
      .body as ApplicationDetail;
  const webhook = (event: object, secret = process.env['CARD_WEBHOOK_SECRET']!) => {
    const body = JSON.stringify(event);
    return request(h.http())
      .post(`${api}/payments/webhooks/card`)
      .set('content-type', 'application/json')
      .set(SIGNATURE_HEADER, signWebhook(secret, body))
      .send(body);
  };
  const event = (type: string, providerRef: string, amountCents: string, extra: object = {}) => ({
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    type,
    providerRef,
    amountCents,
    created: Math.floor(Date.now() / 1000),
    ...extra,
  });
  const actions = async (entityId: string) =>
    (await h.prisma.auditLog.findMany({ where: { entityId }, orderBy: { id: 'asc' } })).map(
      (a) => a.action,
    );

  describe('mobile money: submit → officer confirms → receipt → public verify', () => {
    it('should complete the whole journey with a signed, verifiable receipt', async () => {
      const { session, app } = await submitted();
      expect(app).toMatchObject({
        status: 'AWAITING_PAYMENT',
        balanceCents: '1900',
        paidCents: '0',
      });

      // Evidence screenshot, then the payment report.
      const evidence = await request(h.http())
        .post(`${api}/applications/${app.id}/payment-evidence`)
        .set(bearer(session))
        .send({
          fileName: 'evc.png',
          mime: 'image/png',
          sizeBytes: FILES.png().length,
          sha256: createHash('sha256').update(FILES.png()).digest('hex'),
        });
      expect(evidence.status).toBe(201);
      const ticket = evidence.body as {
        document: { id: string };
        uploadUrl: string;
        headers: Record<string, string>;
      };
      await fetch(ticket.uploadUrl, {
        method: 'PUT',
        headers: ticket.headers,
        body: new Uint8Array(FILES.png()),
      });
      await request(h.http())
        .post(`${api}/documents/${ticket.document.id}/complete`)
        .set(bearer(session))
        .expect(200);
      await waitForDocument(h, ticket.document.id, 'CLEAN');

      const submittedPayment = (
        await pay(session, app.id, '1900', txRef(), {
          evidenceDocumentId: ticket.document.id,
        }).expect(201)
      ).body as PaymentDto;
      expect(submittedPayment.status).toBe('PENDING_VERIFICATION');

      // Officer sees it, opens the evidence (audited) and confirms.
      const queue = (
        await request(h.http())
          .get(`${api}/staff/payments`)
          .set(bearer(officer.session))
          .expect(200)
      ).body as StaffPaymentDto[];
      const item = queue.find((p) => p.id === submittedPayment.id)!;
      expect(item).toMatchObject({
        applicantName: 'Amina Hassan',
        assessedCents: '1900',
        evidenceDocumentId: ticket.document.id,
      });
      await request(h.http())
        .get(`${api}/staff/documents/${ticket.document.id}/download`)
        .set(bearer(officer.session))
        .expect(200);
      expect(await actions(ticket.document.id)).toContain('DOCUMENT_VIEWED');

      const confirmed = (await confirm(officer.session, submittedPayment.id).expect(200))
        .body as StaffPaymentDto;
      expect(confirmed.status).toBe('CONFIRMED');
      expect(confirmed.receiptNo).toMatch(/^R-\d{4}-\d{6}$/);
      const settled = await h.prisma.auditLog.findFirstOrThrow({
        where: { entityId: submittedPayment.id, action: 'PAYMENT_SETTLED' },
      });
      expect(settled.after).toMatchObject({
        receiptNo: confirmed.receiptNo,
        overpaidCents: '0',
        paidTotalCents: '1900',
        assessedCents: '1900',
      });

      const after = await detail(session, app.id);
      expect(after).toMatchObject({ status: 'QUEUED', paidCents: '1900', balanceCents: '0' });
      const row = await h.prisma.application.findUniqueOrThrow({ where: { id: app.id } });
      expect(row.slaDueAt!.getTime()).toBeGreaterThan(Date.now());
      expect(await actions(submittedPayment.id)).toEqual([
        'PAYMENT_SUBMITTED',
        'PAYMENT_CONFIRMED',
        'PAYMENT_SETTLED',
      ]);

      // Receipt PDF for the citizen.
      const pdf = await request(h.http())
        .get(`${api}/payments/${submittedPayment.id}/receipt.pdf`)
        .set(bearer(session))
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

      // Public verification: status + signed payload, masked name only, signature checks out.
      const pub = (
        await request(h.http()).get(`${api}/verify/r/${confirmed.receiptNo}`).expect(200)
      ).body as PublicReceipt;
      expect(pub).toMatchObject({ status: 'VALID', amountCents: '1900' });
      expect(pub.serviceName).toContain('Police clearance');
      // The account holder's name, masked (the form's name is not used on receipts).
      expect(pub.payload.h).toBe('Amina H***');
      expect(JSON.stringify(pub)).not.toContain('SO1234567');
      const keys = (await request(h.http()).get(`${api}/verify/keys`).expect(200))
        .body as PublicKeys;
      const receipt = await h.prisma.receipt.findUniqueOrThrow({
        where: { receiptNo: confirmed.receiptNo! },
      });
      const sig = new URL(h.app.get(ReceiptsService).verifyUrl(receipt)).hash.replace('#sig=', '');
      const key = keys.keys.find((k) => k.kid === pub.payload.kid)!.publicKey;
      expect(await verifySignature(pub.payload, sig, key)).toBe('VALID');
      // A tampered amount or signature fails.
      expect(await verifySignature({ ...pub.payload, amt: '190000' }, sig, key)).toBe('INVALID');
    });

    it('should reject a duplicate transaction ID, even from another citizen', async () => {
      const a = await submitted(0);
      const b = await submitted(0);
      const reference = txRef();
      await pay(a.session, a.app.id, '1500', reference).expect(201);
      const dup = await pay(
        b.session,
        b.app.id,
        '1500',
        reference.toLowerCase().replace(/(\d{3})/, '$1 '),
      );
      expect(dup.status).toBe(409);
      expect((dup.body as ErrorEnvelope).error.code).toBe('DUPLICATE_REFERENCE');
    });

    it('should reject a float amount with 422', async () => {
      const { session, app } = await submitted(0);
      expect((await pay(session, app.id, '15.00')).status).toBe(422);
    });
  });

  describe('confirmation rules', () => {
    it('should let exactly one of two officers confirm the same payment', async () => {
      const { session, app } = await submitted(0);
      const p = (await pay(session, app.id, '1500').expect(201)).body as PaymentDto;
      const results = await Promise.all([
        confirm(officer.session, p.id),
        confirm(officer2.session, p.id),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await h.prisma.receipt.count({ where: { paymentId: p.id } })).toBe(1);
    });

    it('should need a second, different supervisor above the threshold', async () => {
      const { session, app } = await submitted(0);
      const p = (await pay(session, app.id, '15000').expect(201)).body as PaymentDto;
      expect(((await confirm(supA.session, p.id).expect(200)).body as StaffPaymentDto).status).toBe(
        'AWAITING_SUPERVISOR',
      );
      const same = await confirm(supA.session, p.id);
      expect(same.status).toBe(403);
      expect((same.body as ErrorEnvelope).error.code).toBe('SECOND_PERSON_REQUIRED');
      await confirm(officer.session, p.id).expect(403);
      const done = (await confirm(supB.session, p.id).expect(200)).body as StaffPaymentDto;
      expect(done.status).toBe('CONFIRMED');
      // $150.00 paid for a $15.00 fee: $135.00 overpaid and queued.
      expect(done.overpaidCents).toBe('13500');
      const settled = await h.prisma.auditLog.findFirstOrThrow({
        where: { entityId: p.id, action: 'PAYMENT_SETTLED' },
      });
      expect(settled.after).toMatchObject({ overpaidCents: '13500', receiptNo: done.receiptNo });
      expect(settled.actorId).toBe(supB.session.user.id);
      expect((await detail(session, app.id)).status).toBe('QUEUED');
    });

    it('should queue only when partial payments add up to the fee and record later overpayment', async () => {
      const { session, app } = await submitted(2);
      const p1 = (await pay(session, app.id, '1000').expect(201)).body as PaymentDto;
      const p2 = (await pay(session, app.id, '900').expect(201)).body as PaymentDto;
      const p3 = (await pay(session, app.id, '500').expect(201)).body as PaymentDto;
      await confirm(officer.session, p1.id).expect(200);
      expect(await detail(session, app.id)).toMatchObject({
        status: 'AWAITING_PAYMENT',
        paidCents: '1000',
        balanceCents: '900',
      });
      await confirm(officer.session, p2.id).expect(200);
      expect(await detail(session, app.id)).toMatchObject({
        status: 'QUEUED',
        paidCents: '1900',
        balanceCents: '0',
      });
      const late = (await confirm(officer.session, p3.id).expect(200)).body as StaffPaymentDto;
      expect(late.overpaidCents).toBe('500');
    });

    it('should reject with a reason code and release the reference for reuse', async () => {
      const { session, app } = await submitted(0);
      const reference = txRef();
      const p = (await pay(session, app.id, '1500', reference).expect(201)).body as PaymentDto;
      const bad = await request(h.http())
        .post(`${api}/staff/payments/${p.id}/reject`)
        .set(bearer(officer.session))
        .send({ reasonCode: 'NOPE', note: 'Not found' });
      expect(bad.status).toBe(422);
      await request(h.http())
        .post(`${api}/staff/payments/${p.id}/reject`)
        .set(bearer(officer.session))
        .send({ reasonCode: 'REFERENCE_NOT_FOUND', note: 'No such EVC transaction' })
        .expect(200);
      await pay(session, app.id, '1500', reference).expect(201);
    });

    it('should refuse staff of another department with 403', async () => {
      const civil = await signUpStaff(h, 'OFFICER', 'CIVIL_REGISTRY');
      const { session, app } = await submitted(0);
      const p = (await pay(session, app.id, '1500').expect(201)).body as PaymentDto;
      await confirm(civil.session, p.id).expect(403);
      await request(h.http())
        .get(`${api}/staff/payments/${p.id}`)
        .set(bearer(civil.session))
        .expect(403);
      const list = (
        await request(h.http()).get(`${api}/staff/payments`).set(bearer(civil.session)).expect(200)
      ).body as StaffPaymentDto[];
      expect(list.find((x) => x.id === p.id)).toBeUndefined();
      await request(h.http())
        .get(`${api}/payments/${p.id}/receipt.pdf`)
        .set(bearer(civil.session))
        .expect(403);
    });
  });

  describe('cash at the counter', () => {
    it('should confirm cash up to the threshold at once and need a supervisor above it', async () => {
      const { app } = await submitted(0);
      const lookup = await request(h.http())
        .get(`${api}/staff/applications/by-reference/${app.referenceNo}`)
        .set(bearer(officer.session))
        .expect(200);
      expect(lookup.body).toMatchObject({ balanceCents: '1500', applicantName: 'Amina Hassan' });
      const small = await request(h.http())
        .post(`${api}/staff/payments/cash`)
        .set(bearer(officer.session))
        .send({
          referenceNo: app.referenceNo,
          amountCents: '1500',
          receiptBookRef: txRef(),
          payerName: 'Amina Hassan',
        });
      expect((small.body as StaffPaymentDto).status).toBe('CONFIRMED');

      const other = await submitted(0);
      const big = await request(h.http())
        .post(`${api}/staff/payments/cash`)
        .set(bearer(officer.session))
        .send({
          referenceNo: other.app.referenceNo,
          amountCents: '20000',
          receiptBookRef: txRef(),
          payerName: 'Amina Hassan',
        });
      expect((big.body as StaffPaymentDto).status).toBe('AWAITING_SUPERVISOR');
      await confirm(officer.session, (big.body as StaffPaymentDto).id).expect(403);
      await confirm(supA.session, (big.body as StaffPaymentDto).id).expect(200);
    });
  });

  describe('card payments and webhooks', () => {
    it('should confirm a card payment only via a signed webhook, once', async () => {
      const { session, app } = await submitted(1);
      const key = `key-${Date.now()}`;
      const start = await request(h.http())
        .post(`${api}/applications/${app.id}/payments/card`)
        .set(bearer(session))
        .set('Idempotency-Key', key)
        .expect(201);
      const again = await request(h.http())
        .post(`${api}/applications/${app.id}/payments/card`)
        .set(bearer(session))
        .set('Idempotency-Key', key)
        .expect(201);
      expect((again.body as CardCheckout).paymentId).toBe((start.body as CardCheckout).paymentId);
      await request(h.http())
        .post(`${api}/applications/${app.id}/payments/card`)
        .set(bearer(session))
        .expect(400);

      const payment = await h.prisma.payment.findUniqueOrThrow({
        where: { id: (start.body as CardCheckout).paymentId },
      });
      expect(payment).toMatchObject({ status: 'INITIATED', amountCents: 1700n });
      await confirm(officer.session, payment.id).expect(403);

      // Bad signature and wrong secret are refused.
      const ev = event('payment.succeeded', payment.reference, '1700');
      await request(h.http())
        .post(`${api}/payments/webhooks/card`)
        .set('content-type', 'application/json')
        .set(SIGNATURE_HEADER, 't=1,v1=00')
        .send(JSON.stringify(ev))
        .expect(401);
      await webhook(ev, 'x'.repeat(40)).expect(401);

      // Two deliveries of the same event: applied once.
      const results = await Promise.all([webhook(ev), webhook(ev)]);
      expect(results.map((r) => (r.body as { result: string }).result).sort()).toEqual([
        'APPLIED',
        'DUPLICATE',
      ]);
      expect(await h.prisma.paymentEvent.count({ where: { providerEventId: ev.id } })).toBe(1);
      expect(await detail(session, app.id)).toMatchObject({ status: 'QUEUED', paidCents: '1700' });
      expect(await h.prisma.receipt.count({ where: { paymentId: payment.id } })).toBe(1);
    });

    it('should mark a chargeback REVERSED and flag the application without revoking anything', async () => {
      const { session, app } = await submitted(0);
      const start = await request(h.http())
        .post(`${api}/applications/${app.id}/payments/card`)
        .set(bearer(session))
        .set('Idempotency-Key', `key-${Date.now()}-cb`)
        .expect(201);
      const payment = await h.prisma.payment.findUniqueOrThrow({
        where: { id: (start.body as CardCheckout).paymentId },
      });
      await webhook(event('payment.succeeded', payment.reference, '1500')).expect(200);
      await webhook(event('charge.reversed', payment.reference, '1500')).expect(200);
      expect((await h.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'REVERSED',
      );
      const row = await h.prisma.application.findUniqueOrThrow({ where: { id: app.id } });
      expect(row).toMatchObject({ chargebackFlag: true, status: 'QUEUED' });
      expect(await actions(app.id)).toContain('APPLICATION_CHARGEBACK_FLAGGED');
      const receipt = await h.prisma.receipt.findUniqueOrThrow({
        where: { paymentId: payment.id },
      });
      expect(
        (
          (await request(h.http()).get(`${api}/verify/r/${receipt.receiptNo}`))
            .body as PublicReceipt
        ).status,
      ).toBe('REVERSED');
    });

    it('should fail a card payment whose webhook amount does not match', async () => {
      const { session, app } = await submitted(0);
      const start = await request(h.http())
        .post(`${api}/applications/${app.id}/payments/card`)
        .set(bearer(session))
        .set('Idempotency-Key', `key-${Date.now()}-mm`)
        .expect(201);
      const payment = await h.prisma.payment.findUniqueOrThrow({
        where: { id: (start.body as CardCheckout).paymentId },
      });
      await webhook(event('payment.succeeded', payment.reference, '1')).expect(200);
      expect((await h.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'FAILED',
      );
      expect((await detail(session, app.id)).status).toBe('AWAITING_PAYMENT');
    });
  });

  describe('mock gateway checkout and reconciliation', () => {
    it('should serve the checkout page at the returned URL and fail declined payments on reconciliation', async () => {
      const { session, app } = await submitted(0);
      const start = await request(h.http())
        .post(`${api}/applications/${app.id}/payments/card`)
        .set(bearer(session))
        .set('Idempotency-Key', `key-${Date.now()}-mock`)
        .expect(201);
      const { checkoutUrl, paymentId } = start.body as CardCheckout;
      const path = new URL(checkoutUrl).pathname;
      expect(path).toMatch(/^\/api\/v1\/mock-gateway\/checkout\/mock_[0-9a-f]+$/);

      const page = await request(h.http()).get(path).expect(200);
      expect(page.text).toContain('Pay $15.00');
      const decline = await request(h.http()).post(`${path}/decline`).expect(303);
      expect(decline.headers['location']).toContain(`/citizen/applications/${app.id}?card=return`);

      // The webhook cannot reach this test server, so the payment is still pending: reconciliation settles it.
      expect((await h.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe(
        'INITIATED',
      );
      await h.app.get(PaymentsService).reconcileCardPayments(new Date(Date.now() + 20 * 60_000));
      expect((await h.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe(
        'FAILED',
      );
    });
  });

  describe('receipt numbering', () => {
    it('should give concurrent confirmations distinct, gap-free receipt numbers', async () => {
      const apps = await Promise.all([
        submitted(0),
        submitted(0),
        submitted(0),
        submitted(0),
        submitted(0),
      ]);
      const payments = await Promise.all(
        apps.map(
          async (a) => ((await pay(a.session, a.app.id, '1500').expect(201)).body as PaymentDto).id,
        ),
      );
      const before = await h.prisma.receipt.count();
      await Promise.all(payments.map((id) => confirm(officer.session, id).expect(200)));
      const numbers = (
        await h.prisma.receipt.findMany({ where: { paymentId: { in: payments } } })
      ).map((r) => Number(r.receiptNo.split('-')[2]));
      expect(new Set(numbers).size).toBe(5);
      const sorted = numbers.sort((x, y) => x - y);
      expect(sorted[4]! - sorted[0]!).toBe(4);
      expect(sorted[4]).toBe(before + 5);
    });
  });

  describe('refunds', () => {
    it('should never refund more than the payment', async () => {
      const { session, app } = await submitted(0);
      const p = (await pay(session, app.id, '2000').expect(201)).body as PaymentDto;
      await confirm(officer.session, p.id).expect(200);
      await request(h.http())
        .post(`${api}/staff/payments/${p.id}/refunds`)
        .set(bearer(officer.session))
        .send({ reason: 'OVERPAYMENT', amountCents: '500' })
        .expect(201);
      const tooMuch = await request(h.http())
        .post(`${api}/staff/payments/${p.id}/refunds`)
        .set(bearer(officer.session))
        .send({ reason: 'DUPLICATE_PAYMENT', amountCents: '1501' });
      expect(tooMuch.status).toBe(422);
      expect((tooMuch.body as ErrorEnvelope).error.code).toBe('REFUND_EXCEEDS_PAYMENT');
      // Concurrent requests cannot jointly exceed it either.
      const both = await Promise.all([
        request(h.http())
          .post(`${api}/staff/payments/${p.id}/refunds`)
          .set(bearer(officer.session))
          .send({ reason: 'DUPLICATE_PAYMENT', amountCents: '1000' }),
        request(h.http())
          .post(`${api}/staff/payments/${p.id}/refunds`)
          .set(bearer(officer2.session))
          .send({ reason: 'DUPLICATE_PAYMENT', amountCents: '1000' }),
      ]);
      expect(both.map((r) => r.status).sort()).toEqual([201, 422]);
      const sum = (await h.prisma.refund.findMany({ where: { paymentId: p.id } })).reduce(
        (s, r) => s + r.amountCents,
        0n,
      );
      expect(sum).toBe(1500n);
    });

    it('should let only a supervisor approve, then record a manual payout', async () => {
      const { session, app } = await submitted(0);
      const p = (await pay(session, app.id, '2000').expect(201)).body as PaymentDto;
      await confirm(officer.session, p.id).expect(200);
      const r = (
        await request(h.http())
          .post(`${api}/staff/payments/${p.id}/refunds`)
          .set(bearer(officer.session))
          .send({ reason: 'OVERPAYMENT', amountCents: '500' })
          .expect(201)
      ).body as RefundDto;
      await request(h.http())
        .post(`${api}/staff/refunds/${r.id}/approve`)
        .set(bearer(officer.session))
        .expect(403);
      await request(h.http())
        .post(`${api}/staff/refunds/${r.id}/approve`)
        .set(bearer(supA.session))
        .expect(200);
      const done = (
        await request(h.http())
          .post(`${api}/staff/refunds/${r.id}/complete`)
          .set(bearer(supA.session))
          .send({ payoutMethod: 'MOBILE_MONEY', payoutReference: 'EVC-RF-1' })
          .expect(200)
      ).body as RefundDto;
      expect(done.status).toBe('COMPLETED');
      expect(await actions(r.id)).toEqual([
        'REFUND_REQUESTED',
        'REFUND_APPROVED',
        'REFUND_COMPLETED',
      ]);
    });

    it('should complete a card refund from the gateway webhook and show the receipt as REFUNDED', async () => {
      const { session, app } = await submitted(0);
      const start = await request(h.http())
        .post(`${api}/applications/${app.id}/payments/card`)
        .set(bearer(session))
        .set('Idempotency-Key', `key-${Date.now()}-rf`)
        .expect(201);
      const payment = await h.prisma.payment.findUniqueOrThrow({
        where: { id: (start.body as CardCheckout).paymentId },
      });
      await webhook(event('payment.succeeded', payment.reference, '1500')).expect(200);
      const r = (
        await request(h.http())
          .post(`${api}/staff/payments/${payment.id}/refunds`)
          .set(bearer(officer.session))
          .send({ reason: 'DUPLICATE_PAYMENT', amountCents: '1500' })
          .expect(201)
      ).body as RefundDto;
      await request(h.http())
        .post(`${api}/staff/refunds/${r.id}/approve`)
        .set(bearer(supA.session))
        .expect(200);
      await request(h.http())
        .post(`${api}/staff/refunds/${r.id}/complete`)
        .set(bearer(supA.session))
        .send({ payoutMethod: 'CARD', payoutReference: 'x12' })
        .expect(409);
      const { providerRefundId } = await h.prisma.refund.findUniqueOrThrow({ where: { id: r.id } });
      expect(providerRefundId).toBeTruthy();
      expect(await actions(r.id)).toEqual([
        'REFUND_REQUESTED',
        'REFUND_APPROVED',
        'REFUND_SENT_TO_GATEWAY',
      ]);
      await webhook(
        event('refund.succeeded', payment.reference, '1500', { providerRefundId }),
      ).expect(200);
      expect((await h.prisma.refund.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(
        'COMPLETED',
      );
      const receipt = await h.prisma.receipt.findUniqueOrThrow({
        where: { paymentId: payment.id },
      });
      expect(
        (
          (await request(h.http()).get(`${api}/verify/r/${receipt.receiptNo}`))
            .body as PublicReceipt
        ).status,
      ).toBe('REFUNDED');
    });

    it('should decline a refund, and record a failed card refund that a supervisor retries', async () => {
      const { session, app } = await submitted(0);
      const start = await request(h.http())
        .post(`${api}/applications/${app.id}/payments/card`)
        .set(bearer(session))
        .set('Idempotency-Key', `key-${Date.now()}-rx`)
        .expect(201);
      const payment = await h.prisma.payment.findUniqueOrThrow({
        where: { id: (start.body as CardCheckout).paymentId },
      });
      await webhook(event('payment.succeeded', payment.reference, '1500')).expect(200);
      const ask = (amountCents: string) =>
        request(h.http())
          .post(`${api}/staff/payments/${payment.id}/refunds`)
          .set(bearer(officer.session))
          .send({ reason: 'DUPLICATE_PAYMENT', amountCents })
          .expect(201)
          .then((r) => r.body as RefundDto);
      const declined = await ask('100');
      await request(h.http())
        .post(`${api}/staff/refunds/${declined.id}/decline`)
        .set(bearer(supA.session))
        .send({ note: 'Not a duplicate payment' })
        .expect(200);
      expect(await actions(declined.id)).toEqual(['REFUND_REQUESTED', 'REFUND_DECLINED']);

      const r = await ask('1500');
      await request(h.http())
        .post(`${api}/staff/refunds/${r.id}/approve`)
        .set(bearer(supA.session))
        .expect(200);
      const first = await h.prisma.refund.findUniqueOrThrow({ where: { id: r.id } });
      await webhook(
        event('refund.failed', payment.reference, '1500', {
          providerRefundId: first.providerRefundId,
        }),
      ).expect(200);
      expect((await h.prisma.refund.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(
        'FAILED',
      );
      await request(h.http())
        .post(`${api}/staff/refunds/${r.id}/retry`)
        .set(bearer(supA.session))
        .expect(200);
      const second = await h.prisma.refund.findUniqueOrThrow({ where: { id: r.id } });
      await webhook(
        event('refund.succeeded', payment.reference, '1500', {
          providerRefundId: second.providerRefundId,
        }),
      ).expect(200);
      expect((await h.prisma.refund.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(
        'COMPLETED',
      );
      expect(await actions(r.id)).toEqual([
        'REFUND_REQUESTED',
        'REFUND_APPROVED',
        'REFUND_SENT_TO_GATEWAY',
        'REFUND_FAILED',
        'REFUND_RETRIED',
        'REFUND_SENT_TO_GATEWAY',
        'REFUND_COMPLETED',
      ]);
    });

    it('should request refunds automatically when a paid application is withdrawn before review', async () => {
      const { session, app } = await submitted(0);
      const p = (await pay(session, app.id, '1500').expect(201)).body as PaymentDto;
      await confirm(officer.session, p.id).expect(200);
      await request(h.http())
        .post(`${api}/applications/${app.id}/withdraw`)
        .set(bearer(session))
        .expect(200);
      const refunds = await h.prisma.refund.findMany({ where: { paymentId: p.id } });
      expect(refunds).toMatchObject([
        { reason: 'WITHDRAWN_BEFORE_REVIEW', amountCents: 1500n, status: 'REQUESTED' },
      ]);
    });
  });

  describe('unpaid applications (A7)', () => {
    it('should abandon applications unpaid after the deadline and refund partial payments', async () => {
      const { session, app } = await submitted(0);
      const p = (await pay(session, app.id, '1000').expect(201)).body as PaymentDto;
      await confirm(officer.session, p.id).expect(200);
      await h.prisma.application.update({
        where: { id: app.id },
        data: { submittedAt: new Date(Date.now() - 31 * 86_400_000) },
      });
      await h.app.get(PaymentsService).abandonUnpaid();
      expect((await h.prisma.application.findUniqueOrThrow({ where: { id: app.id } })).status).toBe(
        'ABANDONED',
      );
      expect(await h.prisma.refund.findMany({ where: { paymentId: p.id } })).toMatchObject([
        { reason: 'ABANDONED_UNPAID', amountCents: 1000n },
      ]);
    });
  });
});
