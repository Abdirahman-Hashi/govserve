import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type CompleteRefundRequest,
  type RefundDto,
  type RequestRefundRequest,
} from '@govserve/shared';
import { type AuthUser } from '../auth/auth.types';
import { assertSameDepartment } from '../common/guards/scope';
import { type RequestContext } from '../common/request-context';
import {
  type Payment,
  type Prisma,
  type Refund,
  type RefundReason,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CARD_GATEWAY, type CardGatewayPort } from './card-gateway.port';
import { type Actor, MoneyStateService } from './money-state.service';
import { lockPayment } from './money';

type RefundWithPayment = Refund & {
  payment: Payment & {
    application: { referenceNo: string | null; applicantId: string; departmentId: string };
  };
};

const include = {
  payment: {
    include: {
      application: { select: { referenceNo: true, applicantId: true, departmentId: true } },
    },
  },
} as const;

export function toRefundDto(r: RefundWithPayment): RefundDto {
  return {
    id: r.id,
    paymentId: r.paymentId,
    applicationReferenceNo: r.payment.application.referenceNo,
    reason: r.reason,
    amountCents: r.amountCents.toString(),
    status: r.status,
    payoutMethod: r.payoutMethod,
    payoutReference: r.payoutReference,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Refunds (FR-058, STATE_MACHINES §3). Only for withdrawal before review, duplicates,
 * overpayment or abandoned unpaid applications; never for rejection or referral. The total
 * refunded can never exceed the payment (checked under a row lock).
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly money: MoneyStateService,
    @Inject(CARD_GATEWAY) private readonly gateway: CardGatewayPort,
  ) {}

  /** R1 by staff. */
  async request(
    user: AuthUser,
    paymentId: string,
    body: RequestRefundRequest,
    ctx: RequestContext,
  ): Promise<RefundDto> {
    const refund = await this.prisma.$transaction(async (tx) => {
      const payment = await this.paymentIn(tx, paymentId, user);
      return this.create(tx, payment, body.reason, BigInt(body.amountCents), user, {
        note: body.note ?? null,
        ctx,
      });
    });
    return this.get(refund.id);
  }

  /**
   * R1 by the system (A7 abandoned unpaid, A22 withdrawn before review): requests a refund of
   * whatever is still unrefunded on each confirmed payment of the application.
   */
  async requestForApplication(
    tx: Prisma.TransactionClient,
    applicationId: string,
    reason: RefundReason,
  ): Promise<number> {
    const payments = await tx.payment.findMany({
      where: { applicationId, status: 'CONFIRMED' },
      select: { id: true },
    });
    let created = 0;
    for (const { id } of payments) {
      await lockPayment(tx, id);
      const payment = await this.paymentIn(tx, id);
      const remaining = payment.amountCents - (await this.committed(tx, id));
      if (remaining > 0n) {
        await this.create(tx, payment, reason, remaining, 'SYSTEM', {});
        created += 1;
      }
    }
    return created;
  }

  /** R2. Card refunds are then sent to the gateway (after commit); the webhook completes them. */
  async approve(user: AuthUser, id: string, ctx: RequestContext): Promise<RefundDto> {
    const refund = await this.prisma.$transaction(async (tx) => {
      const r = await this.refundIn(tx, id, user);
      return this.money.transitionRefund(tx, r, 'APPROVED', {
        actor: user,
        scope: scopeOf(r),
        ctx,
        data: { approvedById: user.id },
      });
    });
    await this.sendToGateway(refund.id);
    return this.get(id);
  }

  /** R3. */
  async decline(user: AuthUser, id: string, note: string, ctx: RequestContext): Promise<RefundDto> {
    await this.prisma.$transaction(async (tx) => {
      const r = await this.refundIn(tx, id, user);
      await this.money.transitionRefund(tx, r, 'DECLINED', {
        actor: user,
        scope: scopeOf(r),
        ctx,
        data: { note },
        details: { note },
      });
    });
    return this.get(id);
  }

  /** R4 for manual payouts (mobile money, bank, cash): the supervisor records how it was paid. */
  async complete(
    user: AuthUser,
    id: string,
    body: CompleteRefundRequest,
    ctx: RequestContext,
  ): Promise<RefundDto> {
    await this.prisma.$transaction(async (tx) => {
      const r = await this.refundIn(tx, id, user);
      if (r.payment.channel === 'CARD') {
        throw new ConflictException({
          code: 'CARD_REFUND_BY_GATEWAY',
          message: 'Card refunds are completed by the card gateway.',
        });
      }
      await this.money.transitionRefund(tx, r, 'COMPLETED', {
        actor: user,
        scope: scopeOf(r),
        ctx,
        data: { payoutMethod: body.payoutMethod, payoutReference: body.payoutReference },
        details: { payoutMethod: body.payoutMethod },
      });
    });
    return this.get(id);
  }

  /** R6: retry a card refund the gateway failed. */
  async retry(user: AuthUser, id: string, ctx: RequestContext): Promise<RefundDto> {
    await this.prisma.$transaction(async (tx) => {
      const r = await this.refundIn(tx, id, user);
      await this.money.transitionRefund(tx, r, 'APPROVED', { actor: user, scope: scopeOf(r), ctx });
    });
    await this.sendToGateway(id);
    return this.get(id);
  }

  /** Gateway webhooks for refunds (R4 by the system, R5). */
  async onGatewayResult(
    tx: Prisma.TransactionClient,
    providerRefundId: string,
    ok: boolean,
    providerEventId: string,
  ): Promise<void> {
    const r = await tx.refund.findUnique({ where: { providerRefundId }, include });
    if (!r) throw new NotFoundException({ code: 'UNKNOWN_REFUND', message: 'Unknown refund' });
    if (r.status !== 'APPROVED') return; // already settled: duplicate or late delivery
    await this.money.transitionRefund(tx, r, ok ? 'COMPLETED' : 'FAILED', {
      actor: 'SYSTEM',
      scope: scopeOf(r),
      providerEventId,
      ...(ok && { data: { payoutMethod: 'CARD', payoutReference: providerRefundId } }),
    });
  }

  async list(user: AuthUser, status?: Refund['status']): Promise<RefundDto[]> {
    const rows = await this.prisma.refund.findMany({
      where: {
        payment: { application: { departmentId: user.departmentId ?? '' } },
        ...(status && { status }),
      },
      include,
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return rows.map(toRefundDto);
  }

  async get(id: string): Promise<RefundDto> {
    return toRefundDto(await this.prisma.refund.findUniqueOrThrow({ where: { id }, include }));
  }

  /** Totals of refunds that are not declined: requested, approved, failed (retryable) or completed. */
  private async committed(tx: Prisma.TransactionClient, paymentId: string): Promise<bigint> {
    const agg = await tx.refund.aggregate({
      where: { paymentId, status: { not: 'DECLINED' } },
      _sum: { amountCents: true },
    });
    return agg._sum.amountCents ?? 0n;
  }

  private async create(
    tx: Prisma.TransactionClient,
    payment: Payment & { application: { applicantId: string; departmentId: string } },
    reason: RefundReason,
    amount: bigint,
    actor: Actor,
    extra: { note?: string | null; ctx?: RequestContext },
  ): Promise<Refund> {
    if (payment.status !== 'CONFIRMED') {
      throw new ConflictException({
        code: 'NOT_REFUNDABLE',
        message: 'Only confirmed payments can be refunded.',
      });
    }
    await lockPayment(tx, payment.id);
    const already = await this.committed(tx, payment.id);
    if (already + amount > payment.amountCents) {
      throw new UnprocessableEntityException({
        code: 'REFUND_EXCEEDS_PAYMENT',
        message: 'Refunds cannot add up to more than the payment.',
        details: { paymentCents: payment.amountCents.toString(), alreadyCents: already.toString() },
      });
    }
    return this.money.createRefund(
      tx,
      {
        paymentId: payment.id,
        reason,
        amountCents: amount,
        requestedById: actor === 'SYSTEM' ? null : actor.id,
        note: extra.note ?? null,
      },
      {
        actor,
        scope: {
          applicantId: payment.application.applicantId,
          departmentId: payment.application.departmentId,
        },
        ...(extra.ctx && { ctx: extra.ctx }),
      },
    );
  }

  private async sendToGateway(refundId: string): Promise<void> {
    const r = await this.prisma.refund.findUniqueOrThrow({ where: { id: refundId }, include });
    if (r.status !== 'APPROVED' || r.payment.channel !== 'CARD') return;
    try {
      const { providerRefundId } = await this.gateway.refund({
        providerRef: r.payment.reference,
        amountCents: r.amountCents,
        refundId: r.id,
      });
      // The money has left via the gateway: record that even if its webhook never arrives.
      await this.prisma.$transaction(async (tx) => {
        await tx.refund.update({ where: { id: r.id }, data: { providerRefundId } });
        await this.money.recordFact(tx, {
          entityType: 'Refund',
          entityId: r.id,
          paymentId: r.paymentId,
          action: 'REFUND_SENT_TO_GATEWAY',
          actor: 'SYSTEM',
          scope: scopeOf(r),
          details: {
            providerRefundId,
            paymentId: r.paymentId,
            amountCents: r.amountCents.toString(),
          },
        });
      });
    } catch (err) {
      this.logger.error({ err: (err as Error).name, refundId }, 'Card gateway refund failed');
      await this.prisma.$transaction(async (tx) => {
        const current = await this.refundIn(tx, refundId);
        await this.money.transitionRefund(tx, current, 'FAILED', {
          actor: 'SYSTEM',
          scope: scopeOf(current),
          details: { error: 'GATEWAY_ERROR' },
        });
      });
    }
  }

  /** Loads a payment; for staff, the department is checked first so its state is never revealed. */
  private async paymentIn(tx: Prisma.TransactionClient, id: string, user?: AuthUser) {
    const payment = await tx.payment.findUnique({
      where: { id },
      include: { application: { select: { applicantId: true, departmentId: true } } },
    });
    if (!payment) throw new NotFoundException();
    if (user) assertSameDepartment(user, payment.application.departmentId);
    return payment;
  }

  /** Loads a refund; for staff, the department is checked before any state check. */
  private async refundIn(
    tx: Prisma.TransactionClient,
    id: string,
    user?: AuthUser,
  ): Promise<RefundWithPayment> {
    const r = await tx.refund.findUnique({ where: { id }, include });
    if (!r) throw new NotFoundException();
    if (user) assertSameDepartment(user, r.payment.application.departmentId);
    return r;
  }
}

function scopeOf(r: RefundWithPayment) {
  return {
    applicantId: r.payment.application.applicantId,
    departmentId: r.payment.application.departmentId,
  };
}
