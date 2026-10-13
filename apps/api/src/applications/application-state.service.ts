import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService, type AuditActor } from '../audit/audit.service';
import { type AuthUser } from '../auth/auth.types';
import { type RequestContext } from '../common/request-context';
import { type Application, type ApplicationStatus, type Prisma } from '../generated/prisma/client';
import { findTransition, type TransitionActor, type TransitionDef } from './transitions';

export type Actor = AuthUser | 'SYSTEM';

export interface TransitionInput {
  application: Pick<
    Application,
    'id' | 'status' | 'version' | 'applicantId' | 'departmentId' | 'assigneeId' | 'referenceNo'
  >;
  to: ApplicationStatus;
  actor: Actor;
  /** Extra columns to set in the same update (e.g. referenceNo, submittedAt). */
  data?: Prisma.ApplicationUncheckedUpdateManyInput;
  note?: string;
  ctx?: RequestContext;
  /** Extra non-PII audit fields. */
  details?: Record<string, Prisma.InputJsonValue>;
}

const invalidTransition = (from: ApplicationStatus, to: ApplicationStatus) =>
  new ConflictException({
    code: 'INVALID_TRANSITION',
    message: `An application cannot move from ${from} to ${to}`,
    details: { from, to },
  });

/**
 * The only place application status changes (backend rules). Each transition, in the
 * caller's transaction: checks it is allowed from the current status, checks the actor,
 * updates with an optimistic version check, and writes status history, AuditLog and an
 * OutboxEvent (ADR-0005). Transition-specific guards (form valid, paid in full, ...) are
 * checked by the calling service before it calls `transition`.
 */
@Injectable()
export class ApplicationStateService {
  constructor(private readonly audit: AuditService) {}

  /** Throws 404/403/409 exactly as `transition` would, without changing anything. */
  assertAllowed(input: Pick<TransitionInput, 'application' | 'to' | 'actor'>): TransitionDef {
    const { application, to, actor } = input;
    // Ownership is checked first so citizens learn nothing about other people's applications.
    if (actor !== 'SYSTEM' && actor.role === 'CITIZEN' && actor.id !== application.applicantId)
      throw new NotFoundException();
    const def = findTransition(application.status, to);
    if (!def) throw invalidTransition(application.status, to);
    if (!def.actors.some((a) => actorMatches(a, actor, application))) {
      if (
        actor !== 'SYSTEM' &&
        actor.role !== 'CITIZEN' &&
        actor.departmentId !== application.departmentId
      ) {
        throw new ForbiddenException({
          code: 'OUT_OF_DEPARTMENT',
          message: 'This application belongs to another department',
        });
      }
      throw new ForbiddenException({
        code: 'NOT_PERMITTED',
        message: 'You cannot perform this action on this application',
      });
    }
    return def;
  }

  async transition(tx: Prisma.TransactionClient, input: TransitionInput): Promise<Application> {
    const def = this.assertAllowed(input);
    const { application, to, actor } = input;
    const updated = await tx.application.updateMany({
      where: { id: application.id, status: application.status, version: application.version },
      data: { ...input.data, status: to, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        code: 'CONCURRENT_UPDATE',
        message: 'This application was changed by someone else. Reload and try again.',
      });
    }
    const row = await tx.application.findUniqueOrThrow({ where: { id: application.id } });
    await this.record(tx, row, application.status, to, actor, def.audit, input);
    return row;
  }

  /** Writes history, audit and outbox for a lifecycle event (also used for creation and deletion). */
  async record(
    tx: Prisma.TransactionClient,
    row: Pick<Application, 'id' | 'departmentId' | 'applicantId' | 'referenceNo'>,
    from: ApplicationStatus | null,
    to: ApplicationStatus | null,
    actor: Actor,
    action: string,
    input: Pick<TransitionInput, 'note' | 'ctx' | 'details'> = {},
  ): Promise<void> {
    const auditActor: AuditActor =
      actor === 'SYSTEM'
        ? { id: null, role: null, type: 'SYSTEM' }
        : { id: actor.id, role: actor.role, type: 'USER' };
    if (to) {
      await tx.applicationStatusHistory.create({
        data: {
          applicationId: row.id,
          fromStatus: from,
          toStatus: to,
          actorId: auditActor.id,
          actorType: auditActor.type,
          note: input.note ?? null,
        },
      });
    }
    await this.audit.record(tx, {
      actor: auditActor,
      action,
      entityType: 'Application',
      entityId: row.id,
      departmentId: row.departmentId,
      before: { status: from },
      after: {
        status: to,
        ...(row.referenceNo && { referenceNo: row.referenceNo }),
        ...input.details,
      },
      ...(input.ctx && { ctx: input.ctx }),
    });
    await tx.outboxEvent.create({
      data: {
        type: action,
        aggregateType: 'Application',
        aggregateId: row.id,
        // IDs and statuses only: consumers load what they need (no PII in events).
        payload: {
          applicationId: row.id,
          applicantId: row.applicantId,
          departmentId: row.departmentId,
          from,
          to,
          referenceNo: row.referenceNo,
        },
      },
    });
  }
}

function actorMatches(
  rule: TransitionActor,
  actor: Actor,
  app: Pick<Application, 'applicantId' | 'departmentId' | 'assigneeId'>,
): boolean {
  if (rule === 'SYSTEM') return actor === 'SYSTEM';
  if (actor === 'SYSTEM') return false;
  const inDept = actor.departmentId !== null && actor.departmentId === app.departmentId;
  switch (rule) {
    case 'OWNER':
      return actor.role === 'CITIZEN' && actor.id === app.applicantId;
    case 'DEPT_STAFF':
      return (actor.role === 'OFFICER' || actor.role === 'SUPERVISOR') && inDept;
    case 'ASSIGNEE':
      return (
        (actor.role === 'OFFICER' || actor.role === 'SUPERVISOR') &&
        inDept &&
        app.assigneeId === actor.id
      );
    case 'SUPERVISOR':
      return actor.role === 'SUPERVISOR' && inDept;
  }
}
