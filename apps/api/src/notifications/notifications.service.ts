import { Injectable, NotFoundException } from '@nestjs/common';
import {
  EventTemplates,
  linkFor,
  type NotificationDto,
  type NotificationPage,
  type NotificationPreferences,
  type NotificationTemplate,
  type NotificationVars,
} from '@govserve/shared';
import { AuditService } from '../audit/audit.service';
import { type AuthUser } from '../auth/auth.types';
import { type RequestContext } from '../common/request-context';
import { type Notification } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const PAGE = 20;
/** Event messages appear in the app; direct sends (codes, invitations) are only logged. The outbox
 * row may be pruned after 30 days (eventId set to null), so filter by template, not by event. */
const IN_APP: string[] = [...EventTemplates];

/** In-app notification list (FR-100) and email preferences (FR-102). Always the caller's own. */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Keyset by id (UUIDv7 is time-ordered). */
  async list(userId: string, cursor?: string): Promise<NotificationPage> {
    const rows = await this.prisma.notification.findMany({
      where: { userId, template: { in: IN_APP }, ...(cursor && { id: { lt: cursor } }) },
      orderBy: { id: 'desc' },
      take: PAGE + 1,
    });
    const items = rows.slice(0, PAGE).map(toDto);
    return { items, nextCursor: rows.length > PAGE ? items[items.length - 1]!.id : null };
  }

  async unread(userId: string): Promise<{ unread: number }> {
    const unread = await this.prisma.notification.count({
      where: { userId, template: { in: IN_APP }, readAt: null },
    });
    return { unread };
  }

  async markRead(userId: string, id: string): Promise<void> {
    const n = await this.prisma.notification.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!n || n.userId !== userId) throw new NotFoundException();
    await this.prisma.notification.updateMany({
      where: { id, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async preferences(userId: string): Promise<NotificationPreferences> {
    const p = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    return { emailOptional: p?.emailOptional ?? true };
  }

  /** A change to what the system sends someone is audited, with the before and after value. */
  async setPreferences(
    user: AuthUser,
    body: NotificationPreferences,
    ctx: RequestContext,
  ): Promise<NotificationPreferences> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.notificationPreference.findUnique({ where: { userId: user.id } });
      const p = await tx.notificationPreference.upsert({
        where: { userId: user.id },
        create: { userId: user.id, emailOptional: body.emailOptional },
        update: { emailOptional: body.emailOptional },
      });
      await this.audit.record(tx, {
        actor: { id: user.id, role: user.role, type: 'USER' },
        action: 'USER_NOTIFICATION_PREFERENCES_UPDATED',
        entityType: 'User',
        entityId: user.id,
        departmentId: user.departmentId,
        before: { emailOptional: before?.emailOptional ?? true },
        after: { emailOptional: p.emailOptional },
        ctx,
      });
      return { emailOptional: p.emailOptional };
    });
  }
}

function toDto(n: Notification): NotificationDto {
  const vars = n.vars as NotificationVars;
  const template = n.template as NotificationTemplate;
  return {
    id: n.id,
    template,
    vars,
    link: linkFor(template, vars),
    emailStatus: n.status,
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt?.toISOString() ?? null,
  };
}
