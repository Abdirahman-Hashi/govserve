import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type ApplicationLookup,
  type CardCheckout,
  type PaymentDto,
  type RecordCashPaymentRequest,
  type RejectPaymentRequest,
  type StaffPaymentDto,
  type SubmitManualPaymentRequest,
} from '@govserve/shared';
import { ApplicationStateService } from '../applications/application-state.service';
import { type AuthUser } from '../auth/auth.types';
import { assertCitizenOwns, assertSameDepartment } from '../common/guards/scope';
import { type RequestContext } from '../common/request-context';
import { addWorkingDays } from '../common/working-days';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { ConfigAdminService } from '../config-admin/config-admin.service';
import { PAYMENT_EVIDENCE } from '../documents/documents.mapper';
import {
  type Application,
  type Payment,
  Prisma,
  type PaymentStatus,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { CARD_GATEWAY, type CardGatewayPort, type CardWebhookEvent } from './card-gateway.port';
import {
  allocate,
  confirmedTotal,
  lockApplication,
  max,
  normaliseProvider,
  normaliseReference,
} from './money';
import { type Actor, MoneyStateService } from './money-state.service';
import { paymentInclude, toPaymentDto } from './payment.mapper';
import { RefundsService } from './refunds.service';

const RECONCILE_AFTER_MS = 15 * 60_000;
const CARD_EXPIRES_AFTER_MS = 24 * 3_600_000;
const QUEUE_STATUSES: PaymentStatus[] = ['PENDING_VERIFICATION', 'AWAITING_SUPERVISOR'];

const staffInclude = {
  ...paymentInclude,
  application: {
    include: { service: true, applicant: { select: { fullName: true } }, feeAssessment: true },
  },
} as const;

type AppForMoney = Application & {
  service: { name: string; slaWorkingDays: number };
  applicant: { fullName: string };
  feeAssessment: { totalCents: bigint } | null;
};

const duplicateReference = () =>
  new ConflictException({
    code: 'DUPLICATE_REFERENCE',
    message: 'This transaction or slip number has already been used.',
  });

/**
 * Payments (FR-050–FR-061). Status changes go through MoneyStateService. Every confirmation,
 * in one transaction: locks the application, issues the signed receipt, records overpayment,
 * and queues the application once it is paid in full (A5).
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly money: MoneyStateService,
    private readonly appState: ApplicationStateService,
    private readonly receipts: ReceiptsService,
    private readonly refunds: RefundsService,
    private readonly settings: ConfigAdminService,
    @Inject(CARD_GATEWAY) private readonly gateway: CardGatewayPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ─── Citizen: mobile money / bank evidence (P1) ────────────────────────────

  async submitManual(
    user: AuthUser,
    applicationId: string,
    body: SubmitManualPaymentRequest,
    ctx: RequestContext,
  ): Promise<PaymentDto> {
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const app = await this.citizenApp(tx, user, applicationId);
        if (body.evidenceDocumentId) {
          const doc = await tx.document.findUnique({ where: { id: body.evidenceDocumentId } });
          if (
            !doc ||
            doc.ownerId !== user.id ||
            doc.applicationId !== app.id ||
            doc.docType !== PAYMENT_EVIDENCE ||
            !['QUARANTINED', 'CLEAN'].includes(doc.status)
          ) {
            throw new UnprocessableEntityException({
              code: 'VALIDATION_FAILED',
              message: 'Upload the evidence again',
              details: [{ path: 'evidenceDocumentId', message: 'Evidence not found' }],
            });
          }
        }
        const payment = await this.money.createPayment(
          tx,
          {
            applicationId: app.id,
            channel: body.channel,
            provider: body.channel === 'BANK' ? normaliseProvider(body.provider) : body.provider,
            reference: body.reference.trim(),
            referenceNorm: normaliseReference(body.reference),
            amountCents: BigInt(body.amountCents),
            paidAt: new Date(`${body.paidAt}T12:00:00+03:00`),
            status: 'PENDING_VERIFICATION',
            evidenceDocumentId: body.evidenceDocumentId ?? null,
          },
          { actor: user, scope: app, ctx, details: { provider: body.provider } },
        );
        if (body.evidenceDocumentId)
          await tx.document.update({
            where: { id: body.evidenceDocumentId },
            data: { paymentId: payment.id },
          });
        return payment.id;
      });
      return this.dto(id);
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicateReference();
      throw err;
    }
  }

  // ─── Citizen: card (P2) ─────────────────────────────────────────────────────

  async startCard(
    user: AuthUser,
    applicationId: string,
    idempotencyKey: string | undefined,
    ctx: RequestContext,
  ): Promise<CardCheckout> {
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{8,64}$/.test(idempotencyKey)) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Send an Idempotency-Key header (8–64 letters, digits, - or _).',
      });
    }
    const key = `${user.id}:${idempotencyKey}`;
    const existing = await this.prisma.payment.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      if (existing.applicationId !== applicationId || existing.status !== 'INITIATED') {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'This payment request was already used.',
        });
      }
      return { paymentId: existing.id, checkoutUrl: this.checkoutUrlFor(existing) };
    }
    const app = await this.citizenApp(this.prisma, user, applicationId);
    const balance = max(
      app.feeAssessment!.totalCents -
        confirmedTotal(await this.prisma.payment.findMany({ where: { applicationId } })),
      0n,
    );
    if (balance === 0n)
      throw new ConflictException({
        code: 'NOTHING_TO_PAY',
        message: 'This application is already paid.',
      });

    const paymentId = randomUUID();
    const session = await this.gateway.createSession({
      paymentId,
      amountCents: balance,
      returnUrl: `${this.config.WEB_ORIGIN}/citizen/applications/${applicationId}?card=return`,
    });
    try {
      await this.prisma.$transaction((tx) =>
        this.money.createPayment(
          tx,
          {
            id: paymentId,
            applicationId,
            channel: 'CARD',
            provider: 'MOCK_CARD',
            reference: session.providerRef,
            referenceNorm: normaliseReference(session.providerRef),
            amountCents: balance,
            paidAt: new Date(),
            status: 'INITIATED',
            idempotencyKey: key,
          },
          { actor: user, scope: app, ctx },
        ),
      );
    } catch (err) {
      // Two simultaneous requests with the same key: return the one that won.
      if (isUniqueViolation(err)) return this.startCard(user, applicationId, idempotencyKey, ctx);
      throw err;
    }
    return { paymentId, checkoutUrl: session.checkoutUrl };
  }

  // ─── Staff: cash (P3/P4), confirm (P5/P6/P8), reject (P7) ──────────────────

  async recordCash(
    user: AuthUser,
    body: RecordCashPaymentRequest,
    ctx: RequestContext,
  ): Promise<StaffPaymentDto> {
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const app = await tx.application.findUnique({ where: { referenceNo: body.referenceNo } });
        if (!app)
          throw new NotFoundException({
            code: 'UNKNOWN_REFERENCE',
            message: 'No application has this reference.',
          });
        assertSameDepartment(user, app.departmentId);
        await lockApplication(tx, app.id);
        if (app.status !== 'AWAITING_PAYMENT')
          throw new ConflictException({
            code: 'NOT_AWAITING_PAYMENT',
            message: 'This application is not awaiting payment.',
          });
        const amount = BigInt(body.amountCents);
        const needsSupervisor = amount > (await this.threshold());
        const payment = await this.money.createPayment(
          tx,
          {
            applicationId: app.id,
            channel: 'CASH',
            provider: 'CASH_DESK',
            reference: body.receiptBookRef.trim(),
            referenceNorm: normaliseReference(body.receiptBookRef),
            amountCents: amount,
            paidAt: new Date(),
            payerName: body.payerName,
            recordedById: user.id,
            // Above the threshold the recorder is the first confirmer; a supervisor gives the second.
            ...(needsSupervisor && { firstConfirmedById: user.id }),
            status: needsSupervisor ? 'AWAITING_SUPERVISOR' : 'CONFIRMED',
            ...(!needsSupervisor && { confirmedById: user.id, confirmedAt: new Date() }),
          },
          { actor: user, scope: app, ctx },
        );
        if (!needsSupervisor) await this.onConfirmed(tx, payment, user, ctx);
        return payment.id;
      });
      return this.staffDto(id);
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicateReference();
      throw err;
    }
  }

  async confirm(user: AuthUser, paymentId: string, ctx: RequestContext): Promise<StaffPaymentDto> {
    await this.prisma.$transaction(async (tx) => {
      const { payment, scope } = await this.staffPayment(tx, user, paymentId);
      if (payment.channel === 'CARD') {
        throw new ForbiddenException({
          code: 'CARD_CONFIRMED_BY_GATEWAY',
          message: 'Card payments are confirmed only by the card gateway.',
        });
      }
      await lockApplication(tx, payment.applicationId);
      if (payment.status === 'AWAITING_SUPERVISOR') {
        if (payment.firstConfirmedById === user.id) {
          throw new ForbiddenException({
            code: 'SECOND_PERSON_REQUIRED',
            message: 'A different supervisor must give the second confirmation.',
          });
        }
        const row = await this.money.transitionPayment(tx, payment, 'CONFIRMED', {
          actor: user,
          scope,
          ctx,
          data: { confirmedById: user.id, confirmedAt: new Date() },
        });
        await this.onConfirmed(tx, row, user, ctx);
        return;
      }
      if (payment.amountCents > (await this.threshold())) {
        await this.money.transitionPayment(tx, payment, 'AWAITING_SUPERVISOR', {
          actor: user,
          scope,
          ctx,
          data: { firstConfirmedById: user.id },
        });
        return;
      }
      const row = await this.money.transitionPayment(tx, payment, 'CONFIRMED', {
        actor: user,
        scope,
        ctx,
        // Single-step confirmation: only two-step confirmations record a first confirmer.
        data: { confirmedById: user.id, confirmedAt: new Date() },
      });
      await this.onConfirmed(tx, row, user, ctx);
    });
    return this.staffDto(paymentId);
  }

  async reject(
    user: AuthUser,
    paymentId: string,
    body: RejectPaymentRequest,
    ctx: RequestContext,
  ): Promise<StaffPaymentDto> {
    await this.prisma.$transaction(async (tx) => {
      const { payment, scope } = await this.staffPayment(tx, user, paymentId);
      const reason = await tx.reasonCode.findUnique({
        where: { kind_code: { kind: 'PAYMENT_REJECT', code: body.reasonCode } },
      });
      if (!reason || !reason.active) {
        throw new UnprocessableEntityException({
          code: 'VALIDATION_FAILED',
          message: 'Choose a valid reason',
          details: [{ path: 'reasonCode', message: 'Unknown reason' }],
        });
      }
      await this.money.transitionPayment(tx, payment, 'REJECTED', {
        actor: user,
        scope,
        ctx,
        data: { rejectReasonCodeId: reason.id, rejectNote: body.note },
        details: { reasonCode: reason.code },
      });
    });
    return this.staffDto(paymentId);
  }

  // ─── Gateway webhooks (P9, P10, P11, R4, R5) ───────────────────────────────

  /** Applies a verified gateway event once; repeats are recognised by providerEventId. */
  async onCardEvent(event: CardWebhookEvent): Promise<'APPLIED' | 'DUPLICATE' | 'IGNORED'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (await tx.paymentEvent.findUnique({ where: { providerEventId: event.id } }))
          return 'DUPLICATE';
        if (event.type === 'refund.succeeded' || event.type === 'refund.failed') {
          await this.refunds.onGatewayResult(
            tx,
            event.providerRefundId ?? '',
            event.type === 'refund.succeeded',
            event.id,
          );
          return 'APPLIED';
        }
        const payment = await tx.payment.findFirst({
          where: { channel: 'CARD', reference: event.providerRef },
          include: { application: true },
        });
        if (!payment)
          throw new NotFoundException({ code: 'UNKNOWN_PAYMENT', message: 'Unknown payment' });
        await lockApplication(tx, payment.applicationId);
        // Re-check under the lock: a concurrent delivery of the same event may have just committed.
        if (await tx.paymentEvent.findUnique({ where: { providerEventId: event.id } }))
          return 'DUPLICATE';
        const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
        const scope = payment.application;
        const common = { actor: 'SYSTEM' as const, scope, providerEventId: event.id };

        if (event.type === 'payment.succeeded') {
          if (current.status !== 'INITIATED') return 'IGNORED';
          if (BigInt(event.amountCents) !== current.amountCents) {
            await this.money.transitionPayment(tx, current, 'FAILED', {
              ...common,
              details: { error: 'AMOUNT_MISMATCH', gatewayAmountCents: event.amountCents },
            });
            return 'APPLIED';
          }
          const row = await this.money.transitionPayment(tx, current, 'CONFIRMED', {
            ...common,
            data: { confirmedAt: new Date() },
          });
          await this.onConfirmed(tx, row, 'SYSTEM');
          return 'APPLIED';
        }
        if (event.type === 'payment.failed') {
          if (current.status !== 'INITIATED') return 'IGNORED';
          await this.money.transitionPayment(tx, current, 'FAILED', common);
          return 'APPLIED';
        }
        // charge.reversed (P9): flag the application for a supervisor; nothing is revoked automatically.
        if (current.status !== 'CONFIRMED') return 'IGNORED';
        await this.money.transitionPayment(tx, current, 'REVERSED', common);
        await tx.application.update({
          where: { id: payment.applicationId },
          data: { chargebackFlag: true },
        });
        await this.appState.record(
          tx,
          payment.application,
          payment.application.status,
          null,
          'SYSTEM',
          'APPLICATION_CHARGEBACK_FLAGGED',
          {
            details: { paymentId: payment.id },
          },
        );
        return 'APPLIED';
      });
    } catch (err) {
      // A concurrent delivery of the same event lost the race on the unique providerEventId.
      if (isUniqueViolation(err)) return 'DUPLICATE';
      throw err;
    }
  }

  // ─── Jobs ───────────────────────────────────────────────────────────────────

  /** Card payments still pending: ask the gateway; give up after 24 h (P10/P11). */
  async reconcileCardPayments(now = new Date()): Promise<number> {
    const stale = await this.prisma.payment.findMany({
      where: {
        channel: 'CARD',
        status: 'INITIATED',
        createdAt: { lt: new Date(now.getTime() - RECONCILE_AFTER_MS) },
      },
      take: 100,
    });
    let settled = 0;
    for (const p of stale) {
      const status = await this.gateway.getStatus(p.reference);
      const expired = now.getTime() - p.createdAt.getTime() > CARD_EXPIRES_AFTER_MS;
      if (status === 'PENDING' && !expired) continue;
      const type = status === 'SUCCEEDED' ? 'payment.succeeded' : 'payment.failed';
      const result = await this.onCardEvent({
        id: `reconcile_${p.id}_${type}`,
        type,
        providerRef: p.reference,
        amountCents: p.amountCents.toString(),
        created: Math.floor(now.getTime() / 1000),
      });
      if (result === 'APPLIED') settled += 1;
    }
    return settled;
  }

  /** A7: unpaid applications are abandoned after the configured days; partial payments are refunded. */
  async abandonUnpaid(now = new Date()): Promise<number> {
    const days = await this.settings.get('payment.unpaidAbandonDays');
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const candidates = await this.prisma.application.findMany({
      where: {
        status: 'AWAITING_PAYMENT',
        submittedAt: { lt: cutoff },
        payments: {
          none: { status: { in: ['PENDING_VERIFICATION', 'AWAITING_SUPERVISOR', 'INITIATED'] } },
        },
      },
      take: 200,
    });
    let count = 0;
    for (const app of candidates) {
      await this.prisma
        .$transaction(async (tx) => {
          await lockApplication(tx, app.id);
          const fresh = await tx.application.findUniqueOrThrow({ where: { id: app.id } });
          await this.appState.transition(tx, {
            application: fresh,
            to: 'ABANDONED',
            actor: 'SYSTEM',
            note: `Not paid within ${days} days`,
            data: { decidedAt: now },
          });
          await this.refunds.requestForApplication(tx, app.id, 'ABANDONED_UNPAID');
          count += 1;
        })
        .catch((err: unknown) => {
          if (err instanceof ConflictException) return; // changed meanwhile; next run will see it
          throw err;
        });
    }
    return count;
  }

  // ─── Reads ──────────────────────────────────────────────────────────────────

  async staffList(user: AuthUser, status?: PaymentStatus): Promise<StaffPaymentDto[]> {
    const where: Prisma.PaymentWhereInput = {
      application: { departmentId: user.departmentId ?? '' },
      status: status
        ? status
        : { in: user.role === 'SUPERVISOR' ? QUEUE_STATUSES : ['PENDING_VERIFICATION'] },
    };
    const rows = await this.prisma.payment.findMany({
      where,
      include: staffInclude,
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return rows.map(toStaffPaymentDto);
  }

  async staffGet(user: AuthUser, id: string): Promise<StaffPaymentDto> {
    await this.staffPayment(this.prisma, user, id);
    return this.staffDto(id);
  }

  async lookup(user: AuthUser, referenceNo: string): Promise<ApplicationLookup> {
    const app = await this.prisma.application.findUnique({
      where: { referenceNo },
      include: {
        service: true,
        applicant: { select: { fullName: true } },
        feeAssessment: true,
        payments: true,
      },
    });
    if (!app)
      throw new NotFoundException({
        code: 'UNKNOWN_REFERENCE',
        message: 'No application has this reference.',
      });
    assertSameDepartment(user, app.departmentId);
    const assessed = app.feeAssessment?.totalCents ?? 0n;
    const paid = confirmedTotal(app.payments);
    return {
      id: app.id,
      referenceNo,
      serviceName: app.service.name,
      applicantName: app.applicant.fullName,
      status: app.status,
      assessedCents: assessed.toString(),
      paidCents: paid.toString(),
      balanceCents: max(assessed - paid, 0n).toString(),
    };
  }

  /** Receipt PDF for the owner citizen or staff of the department. */
  async receiptPdf(user: AuthUser, paymentId: string): Promise<{ fileName: string; pdf: Buffer }> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { application: true, receipt: true, refunds: true },
    });
    if (!payment) throw new NotFoundException();
    if (user.role === 'CITIZEN') assertCitizenOwns(user, payment.application.applicantId);
    else assertSameDepartment(user, payment.application.departmentId);
    if (!payment.receipt)
      throw new ConflictException({
        code: 'NO_RECEIPT',
        message: 'This payment has no receipt yet.',
      });
    const pdf = await this.receipts.pdf(
      { ...payment.receipt, payment },
      payment.application.referenceNo,
    );
    return { fileName: `${payment.receipt.receiptNo}.pdf`, pdf };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * After any confirmation, inside the same transaction (caller holds the application lock):
   * issue the receipt, record overpayment, and queue the application when fully paid (A5).
   */
  private async onConfirmed(
    tx: Prisma.TransactionClient,
    payment: Payment,
    actor: Actor,
    ctx?: RequestContext,
  ): Promise<void> {
    const app = (await tx.application.findUniqueOrThrow({
      where: { id: payment.applicationId },
      include: { service: true, applicant: { select: { fullName: true } }, feeAssessment: true },
    })) as AppForMoney;
    const receipt = await this.receipts.issue(tx, payment, {
      serviceName: app.service.name,
      applicantName: app.applicant.fullName,
    });

    const all = await tx.payment.findMany({ where: { applicationId: app.id } });
    const paidAfter = confirmedTotal(all);
    const { overpaid, fullyPaid } = allocate({
      assessed: app.feeAssessment?.totalCents ?? 0n,
      paidBefore: paidAfter - payment.amountCents,
      amount: payment.amountCents,
      awaitingPayment: app.status === 'AWAITING_PAYMENT',
    });
    if (overpaid > 0n)
      await tx.payment.update({ where: { id: payment.id }, data: { overpaidCents: overpaid } });
    // What the confirmation settled: receipt number, overpayment and the running total (audited).
    await this.money.recordFact(tx, {
      entityType: 'Payment',
      entityId: payment.id,
      paymentId: payment.id,
      action: 'PAYMENT_SETTLED',
      actor,
      scope: app,
      ...(ctx && { ctx }),
      details: {
        receiptNo: receipt.receiptNo,
        amountCents: payment.amountCents.toString(),
        overpaidCents: overpaid.toString(),
        paidTotalCents: paidAfter.toString(),
        assessedCents: (app.feeAssessment?.totalCents ?? 0n).toString(),
      },
    });

    if (fullyPaid && app.kind === 'STANDARD') {
      const now = new Date();
      const [week, holidays] = await Promise.all([
        this.settings.get('calendar.workingWeek'),
        tx.holiday.findMany({ select: { date: true } }),
      ]);
      const slaDueAt = addWorkingDays(
        now,
        app.service.slaWorkingDays,
        week,
        new Set(holidays.map((h) => h.date.toISOString().slice(0, 10))),
      );
      await this.appState.transition(tx, {
        application: app,
        to: 'QUEUED',
        actor: 'SYSTEM',
        ...(ctx && { ctx }),
        data: { queuedAt: now, slaDueAt },
        details: {
          paidCents: paidAfter.toString(),
          triggeredBy: actor === 'SYSTEM' ? 'GATEWAY' : actor.id,
        },
      });
    }
    // TODO(Phase 06): DUPLICATE applications issue the certificate copy here (A6).
  }

  private async threshold(): Promise<bigint> {
    return BigInt(await this.settings.get('payment.supervisorThresholdCents'));
  }

  private async citizenApp(db: Prisma.TransactionClient, user: AuthUser, applicationId: string) {
    const app = await db.application.findUnique({
      where: { id: applicationId },
      include: { feeAssessment: true },
    });
    if (!app) throw new NotFoundException();
    assertCitizenOwns(user, app.applicantId);
    if (app.status !== 'AWAITING_PAYMENT' || !app.feeAssessment) {
      throw new ConflictException({
        code: 'NOT_AWAITING_PAYMENT',
        message: 'This application is not awaiting payment.',
      });
    }
    return app;
  }

  private async staffPayment(db: Prisma.TransactionClient, user: AuthUser, paymentId: string) {
    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      include: { application: { select: { applicantId: true, departmentId: true } } },
    });
    if (!payment) throw new NotFoundException();
    assertSameDepartment(user, payment.application.departmentId);
    return { payment, scope: payment.application };
  }

  private checkoutUrlFor(payment: Payment): string {
    return `${this.config.PUBLIC_API_URL}/api/v1/mock-gateway/checkout/${payment.reference}`;
  }

  private async dto(id: string): Promise<PaymentDto> {
    return toPaymentDto(
      await this.prisma.payment.findUniqueOrThrow({ where: { id }, include: paymentInclude }),
    );
  }

  private async staffDto(id: string): Promise<StaffPaymentDto> {
    return toStaffPaymentDto(
      await this.prisma.payment.findUniqueOrThrow({ where: { id }, include: staffInclude }),
    );
  }
}

function toStaffPaymentDto(
  p: Prisma.PaymentGetPayload<{ include: typeof staffInclude }>,
): StaffPaymentDto {
  return {
    ...toPaymentDto(p),
    applicationReferenceNo: p.application.referenceNo,
    serviceName: p.application.service.name,
    applicantName: p.application.applicant.fullName,
    assessedCents: (p.application.feeAssessment?.totalCents ?? 0n).toString(),
    evidenceDocumentId: p.evidenceDocumentId,
    firstConfirmedById: p.firstConfirmedById,
    payerName: p.payerName,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
