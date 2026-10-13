import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { type Queue } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { type OutboxEvent, type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { type EventContext, plan } from './planner';
import { DELIVER_JOB, NOTIFY_QUEUE } from './queues';

const STALE_QUEUED_MS = 10 * 60_000;

/**
 * Relays outbox events to notifications (ADR-0005, FR-102). Each batch claims events with
 * SKIP LOCKED, writes one Notification per (event, channel, recipient) — the unique key makes a
 * replayed event a no-op — marks them dispatched, and only then enqueues delivery jobs.
 */
@Injectable()
export class OutboxRelayService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(NOTIFY_QUEUE) private readonly queue: Queue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async relayBatch(limit = 100): Promise<number> {
    const created = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "outbox_event" WHERE "dispatchedAt" IS NULL
        ORDER BY "createdAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
      if (claimed.length === 0) return [];
      const events = await tx.outboxEvent.findMany({
        where: { id: { in: claimed.map((c) => c.id) } },
        orderBy: { createdAt: 'asc' },
      });
      const ids: string[] = [];
      for (const event of events) ids.push(...(await this.notify(tx, event)));
      await tx.outboxEvent.updateMany({
        where: { id: { in: events.map((e) => e.id) } },
        data: { dispatchedAt: new Date(), attempts: { increment: 1 } },
      });
      return ids;
    });
    await this.enqueue(created);
    return created.length;
  }

  /** Re-enqueues deliveries left QUEUED (a crash between commit and enqueue). */
  async sweep(now = new Date()): Promise<number> {
    const stale = await this.prisma.notification.findMany({
      where: { status: 'QUEUED', updatedAt: { lt: new Date(now.getTime() - STALE_QUEUED_MS) } },
      select: { id: true },
      take: 500,
    });
    await this.enqueue(stale.map((n) => n.id));
    return stale.length;
  }

  enqueue(ids: string[]): Promise<unknown> {
    return Promise.all(
      ids.map((id) =>
        this.queue.add(
          DELIVER_JOB,
          { notificationId: id },
          {
            // The job id makes a second enqueue of a waiting job a no-op.
            jobId: id,
            attempts: this.config.NOTIFY_ATTEMPTS,
            backoff: { type: 'exponential', delay: this.config.NOTIFY_BACKOFF_MS },
            removeOnComplete: true,
            removeOnFail: true,
          },
        ),
      ),
    );
  }

  private async notify(tx: Prisma.TransactionClient, event: OutboxEvent): Promise<string[]> {
    const ctx = await this.load(tx, event);
    const intents = plan(ctx);
    const ids: string[] = [];
    for (const i of intents) {
      const app = ctx.application;
      const users = await tx.user.findMany({
        where:
          i.recipients === 'ADMINS'
            ? { role: 'ADMIN', status: 'ACTIVE' }
            : i.recipients === 'APPLICANT'
              ? { id: app!.applicantId }
              : { role: 'SUPERVISOR', status: 'ACTIVE', departmentId: app!.departmentId },
        select: { id: true, notificationPreference: true },
      });
      for (const user of users) {
        const optedOut = !i.mandatory && user.notificationPreference?.emailOptional === false;
        const row = await tx.notification.upsert({
          where: {
            eventId_channel_userId: { eventId: event.id, channel: 'EMAIL', userId: user.id },
          },
          create: {
            userId: user.id,
            eventId: event.id,
            template: i.template,
            vars: i.vars,
            mandatory: i.mandatory,
            status: optedOut ? 'SKIPPED' : 'QUEUED',
          },
          update: {},
        });
        if (row.status === 'QUEUED' && row.attempts === 0) ids.push(row.id);
      }
    }
    return ids;
  }

  /** Loads what the planner needs; IDs and non-PII facts only. */
  private async load(tx: Prisma.TransactionClient, event: OutboxEvent): Promise<EventContext> {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const str = (k: string) => (typeof payload[k] === 'string' ? payload[k] : null);
    let applicationId = str('applicationId');
    if (!applicationId && str('paymentId')) {
      const payment = await tx.payment.findUnique({
        where: { id: str('paymentId')! },
        select: { applicationId: true },
      });
      applicationId = payment?.applicationId ?? null;
    }
    const application = applicationId
      ? await tx.application.findUnique({
          where: { id: applicationId },
          select: {
            id: true,
            referenceNo: true,
            kind: true,
            applicantId: true,
            departmentId: true,
          },
        })
      : null;
    const ctx: EventContext = { type: event.type, payload, application };
    if (application && event.type === 'APPOINTMENT_SCHEDULED') {
      ctx.appointment = await tx.appointment.findFirst({
        where: { applicationId: application.id, status: 'SCHEDULED' },
        orderBy: { createdAt: 'desc' },
        select: { scheduledAt: true, location: true, rescheduleCount: true },
      });
    }
    if (application && event.type === 'APPLICATION_CORRECTION_REQUESTED') {
      const open = await tx.correctionRequest.findFirst({
        where: { applicationId: application.id },
        orderBy: { round: 'desc' },
        select: { dueAt: true },
      });
      ctx.correctionDueAt = open?.dueAt ?? null;
    }
    return ctx;
  }
}
