import { Injectable } from '@nestjs/common';
import { type Role } from '@govserve/shared';
import { type Prisma } from '../generated/prisma/client';
import { type RequestContext } from '../common/request-context';

export interface AuditActor {
  id: string | null;
  role: Role | null;
  type: 'USER' | 'SYSTEM' | 'PUBLIC';
}

export const SYSTEM_ACTOR: AuditActor = { id: null, role: null, type: 'SYSTEM' };
export const PUBLIC_ACTOR: AuditActor = { id: null, role: null, type: 'PUBLIC' };

export interface AuditEvent {
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId: string;
  departmentId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ctx?: RequestContext;
}

/**
 * Writes AuditLog rows. Always called with the caller's transaction client so the audit
 * row commits or rolls back with the change it describes (CLAUDE.md non-negotiable).
 * Never pass PII or secrets in before/after.
 */
@Injectable()
export class AuditService {
  async record(tx: Prisma.TransactionClient, event: AuditEvent): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId: event.actor.id,
        actorRole: event.actor.role,
        actorType: event.actor.type,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        departmentId: event.departmentId ?? null,
        ...(event.before !== undefined && { before: event.before }),
        ...(event.after !== undefined && { after: event.after }),
        ip: event.ctx?.ip ?? null,
        userAgent: event.ctx?.userAgent ?? null,
        requestId: event.ctx?.requestId ?? null,
      },
    });
  }
}
