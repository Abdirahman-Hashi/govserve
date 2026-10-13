import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { type AuthUser } from '../auth/auth.types';
import { type RequestContext } from '../common/request-context';
import {
  type Payment,
  type PaymentStatus,
  type Prisma,
  type Refund,
  type RefundStatus,
} from '../generated/prisma/client';
import { type MoneyActor, PAYMENT_TRANSITIONS, REFUND_TRANSITIONS } from './payment-transitions';

export type Actor = AuthUser | 'SYSTEM';

/** What actor checks need to know about the payment's application. */
export interface MoneyScope {
  applicantId: string;
  departmentId: string;
}

interface Common {
  scope: MoneyScope;
  actor: Actor;
  ctx?: RequestContext;
  /** Non-PII details recorded on the event and audit row. */
  details?: Record<string, Prisma.InputJsonValue | null>;
  /** Gateway event ID: a repeat delivery is detected by its unique index. */
  providerEventId?: string;
}

const invalid = (kind: string, from: string | null, to: string) =>
  new ConflictException({
    code: 'INVALID_TRANSITION',
    message: `A ${kind} cannot move from ${from ?? 'new'} to ${to}`,
    details: { from, to },
  });

function matches(rule: MoneyActor, actor: Actor, scope: MoneyScope): boolean {
  if (rule === 'SYSTEM') return actor === 'SYSTEM';
  if (actor === 'SYSTEM') return false;
  const inDept = actor.departmentId !== null && actor.departmentId === scope.departmentId;
  if (rule === 'OWNER') return actor.role === 'CITIZEN' && actor.id === scope.applicantId;
  if (rule === 'DEPT_STAFF')
    return (actor.role === 'OFFICER' || actor.role === 'SUPERVISOR') && inDept;
  return actor.role === 'SUPERVISOR' && inDept;
}

function assertActor(actors: MoneyActor[], actor: Actor, scope: MoneyScope): void {
  if (actor !== 'SYSTEM' && actor.role === 'CITIZEN' && actor.id !== scope.applicantId)
    throw new NotFoundException();
  if (actors.some((a) => matches(a, actor, scope))) return;
  if (actor !== 'SYSTEM' && actor.role !== 'CITIZEN' && actor.departmentId !== scope.departmentId) {
    throw new ForbiddenException({
      code: 'OUT_OF_DEPARTMENT',
      message: 'This payment belongs to another department',
    });
  }
  throw new ForbiddenException({
    code: 'NOT_PERMITTED',
    message: 'You cannot perform this action on this payment',
  });
}

/**
 * The only place payment and refund statuses change (backend rules). Each change runs in the
 * caller's transaction with an optimistic version check and writes PaymentEvent + AuditLog +
 * OutboxEvent alongside it.
 */
@Injectable()
export class MoneyStateService {
  constructor(private readonly audit: AuditService) {}

  assertPayment(
    from: PaymentStatus | null,
    to: PaymentStatus,
    actor: Actor,
    scope: MoneyScope,
  ): string {
    const def = PAYMENT_TRANSITIONS.find((t) => t.from === from && t.to === to);
    // Ownership first so citizens learn nothing about other people's payments.
    if (actor !== 'SYSTEM' && actor.role === 'CITIZEN' && actor.id !== scope.applicantId)
      throw new NotFoundException();
    if (!def) throw invalid('payment', from, to);
    assertActor(def.actors, actor, scope);
    return def.audit;
  }

  /** Creates a payment in its first status (P1–P4). */
  async createPayment(
    tx: Prisma.TransactionClient,
    data: Prisma.PaymentUncheckedCreateInput & { status: PaymentStatus },
    input: Common,
  ): Promise<Payment> {
    const audit = this.assertPayment(null, data.status, input.actor, input.scope);
    const payment = await tx.payment.create({ data });
    await this.recordPayment(tx, payment, null, data.status, audit, input);
    return payment;
  }

  async transitionPayment(
    tx: Prisma.TransactionClient,
    payment: Pick<Payment, 'id' | 'status' | 'version'>,
    to: PaymentStatus,
    input: Common & { data?: Prisma.PaymentUncheckedUpdateManyInput },
  ): Promise<Payment> {
    const audit = this.assertPayment(payment.status, to, input.actor, input.scope);
    const changed = await tx.payment.updateMany({
      where: { id: payment.id, status: payment.status, version: payment.version },
      data: { ...input.data, status: to, version: { increment: 1 } },
    });
    if (changed.count !== 1) {
      throw new ConflictException({
        code: 'CONCURRENT_UPDATE',
        message: 'This payment was just changed by someone else. Reload and try again.',
      });
    }
    const row = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    await this.recordPayment(tx, row, payment.status, to, audit, input);
    return row;
  }

  async createRefund(
    tx: Prisma.TransactionClient,
    data: Prisma.RefundUncheckedCreateInput,
    input: Common,
  ): Promise<Refund> {
    const def = REFUND_TRANSITIONS.find((t) => t.from === null && t.to === 'REQUESTED')!;
    assertActor(def.actors, input.actor, input.scope);
    const refund = await tx.refund.create({ data: { ...data, status: 'REQUESTED' } });
    await this.recordRefund(tx, refund, null, 'REQUESTED', def.audit, input);
    return refund;
  }

  async transitionRefund(
    tx: Prisma.TransactionClient,
    refund: Pick<Refund, 'id' | 'status' | 'version' | 'paymentId'>,
    to: RefundStatus,
    input: Common & { data?: Prisma.RefundUncheckedUpdateManyInput },
  ): Promise<Refund> {
    const def = REFUND_TRANSITIONS.find((t) => t.from === refund.status && t.to === to);
    if (!def) throw invalid('refund', refund.status, to);
    assertActor(def.actors, input.actor, input.scope);
    const changed = await tx.refund.updateMany({
      where: { id: refund.id, status: refund.status, version: refund.version },
      data: { ...input.data, status: to, version: { increment: 1 } },
    });
    if (changed.count !== 1) {
      throw new ConflictException({
        code: 'CONCURRENT_UPDATE',
        message: 'This refund was just changed by someone else. Reload and try again.',
      });
    }
    const row = await tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
    await this.recordRefund(tx, row, refund.status, to, def.audit, input);
    return row;
  }

  /**
   * Records a money fact that is not a status change (e.g. receipt issued with overpayment,
   * refund sent to the gateway): PaymentEvent + AuditLog + OutboxEvent in the caller's transaction.
   */
  async recordFact(
    tx: Prisma.TransactionClient,
    fact: {
      entityType: 'Payment' | 'Refund';
      entityId: string;
      paymentId: string;
      action: string;
      details: Record<string, Prisma.InputJsonValue | null>;
    } & Pick<Common, 'actor' | 'scope' | 'ctx'>,
  ): Promise<void> {
    await tx.paymentEvent.create({
      data: {
        paymentId: fact.paymentId,
        type: fact.action,
        actorId: fact.actor === 'SYSTEM' ? null : fact.actor.id,
        payload: fact.details,
      },
    });
    await this.writeAudit(tx, fact.entityType, fact.entityId, fact.action, fact, {}, fact.details);
  }

  private async recordPayment(
    tx: Prisma.TransactionClient,
    payment: Payment,
    from: PaymentStatus | null,
    to: PaymentStatus,
    action: string,
    input: Common,
  ): Promise<void> {
    const actorId = input.actor === 'SYSTEM' ? null : input.actor.id;
    const details = {
      channel: payment.channel,
      amountCents: payment.amountCents.toString(),
      applicationId: payment.applicationId,
      ...input.details,
    };
    await tx.paymentEvent.create({
      data: {
        paymentId: payment.id,
        type: action,
        fromStatus: from,
        toStatus: to,
        actorId,
        payload: details,
        providerEventId: input.providerEventId ?? null,
      },
    });
    await this.writeAudit(
      tx,
      'Payment',
      payment.id,
      action,
      input,
      { status: from },
      { status: to, ...details },
    );
  }

  private async recordRefund(
    tx: Prisma.TransactionClient,
    refund: Refund,
    from: RefundStatus | null,
    to: RefundStatus,
    action: string,
    input: Common,
  ): Promise<void> {
    const details = {
      paymentId: refund.paymentId,
      reason: refund.reason,
      amountCents: refund.amountCents.toString(),
      ...input.details,
    };
    // Refund history lives on the payment's event stream.
    await tx.paymentEvent.create({
      data: {
        paymentId: refund.paymentId,
        type: action,
        actorId: input.actor === 'SYSTEM' ? null : input.actor.id,
        payload: { refundId: refund.id, from, to, ...details },
        providerEventId: input.providerEventId ?? null,
      },
    });
    await this.writeAudit(
      tx,
      'Refund',
      refund.id,
      action,
      input,
      { status: from },
      { status: to, ...details },
    );
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    entityType: string,
    entityId: string,
    action: string,
    input: Common,
    before: Prisma.InputJsonValue,
    after: Record<string, Prisma.InputJsonValue | null>,
  ): Promise<void> {
    await this.audit.record(tx, {
      actor:
        input.actor === 'SYSTEM'
          ? { id: null, role: null, type: 'SYSTEM' }
          : { id: input.actor.id, role: input.actor.role, type: 'USER' },
      action,
      entityType,
      entityId,
      departmentId: input.scope.departmentId,
      before,
      after,
      ...(input.ctx && { ctx: input.ctx }),
    });
    await tx.outboxEvent.create({
      data: {
        type: action,
        aggregateType: entityType,
        aggregateId: entityId,
        payload: {
          [`${entityType.toLowerCase()}Id`]: entityId,
          applicantId: input.scope.applicantId,
          departmentId: input.scope.departmentId,
          ...after,
        },
      },
    });
  }
}
