import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { linkFor, type NotificationVars } from '@govserve/shared';
import { type Job, Queue, UnrecoverableError } from 'bullmq';
import { firstName } from '../auth/session-user';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDeliveryError } from './notification-delivery.error';
import {
  NOTIFICATION_PORT,
  type NotificationPort,
  type NotificationTemplate,
} from './notification.port';
import { DELIVER_JOB, NOTIFY_DEAD_QUEUE, NOTIFY_QUEUE } from './queues';

type DeliverJob = Job<{ notificationId: string }>;

/** SMTP 5xx (and a missing address) will not succeed on retry. */
function isPermanent(err: NotificationDeliveryError): boolean {
  return (
    (err.responseCode !== undefined && err.responseCode >= 500) || err.transportCode === 'EENVELOPE'
  );
}

/**
 * Delivers one notification (FR-102): retries with exponential backoff, then dead-letters.
 * A row already SENT is never sent again, so replays and duplicate jobs are harmless.
 */
@Processor(NOTIFY_QUEUE)
export class DeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(DeliveryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATION_PORT) private readonly port: NotificationPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectQueue(NOTIFY_DEAD_QUEUE) private readonly dead: Queue,
    private readonly metrics: MetricsService,
  ) {
    super();
  }

  async process(job: DeliverJob): Promise<void> {
    if (job.name !== DELIVER_JOB) return;
    const n = await this.prisma.notification.findUnique({
      where: { id: job.data.notificationId },
      include: { user: { select: { email: true, fullName: true, status: true } } },
    });
    if (!n || (n.status !== 'QUEUED' && n.status !== 'FAILED')) return;
    if (n.user.status === 'DEACTIVATED') {
      await this.prisma.notification.update({
        where: { id: n.id },
        data: { status: 'DEAD', lastError: 'RECIPIENT_DEACTIVATED' },
      });
      return;
    }
    const vars = n.vars as NotificationVars;
    const link = linkFor(n.template as NotificationTemplate, vars);
    try {
      const result = await this.port.send({
        to: n.user.email,
        template: n.template as NotificationTemplate,
        vars: {
          firstName: firstName(n.user.fullName),
          ...Object.fromEntries(
            Object.entries(vars).filter((e): e is [string, string] => typeof e[1] === 'string'),
          ),
          ...(link && { link: `${this.config.WEB_ORIGIN}${link}` }),
        },
      });
      await this.prisma.notification.update({
        where: { id: n.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          attempts: { increment: 1 },
          providerMessageId: result.providerMessageId ?? null,
          lastError: null,
        },
      });
    } catch (err) {
      const safe =
        err instanceof NotificationDeliveryError
          ? err
          : NotificationDeliveryError.from(n.template, err);
      await this.prisma.notification.update({
        where: { id: n.id },
        data: {
          status: 'FAILED',
          attempts: { increment: 1 },
          lastError:
            [safe.transportCode, safe.responseCode].filter(Boolean).join(' ') || 'SEND_FAILED',
        },
      });
      if (isPermanent(safe)) throw new UnrecoverableError(safe.message);
      throw safe;
    }
  }

  /** After the last attempt (or a permanent failure): DEAD, and a copy in the dead-letter queue. */
  @OnWorkerEvent('failed')
  async onFailed(job: DeliverJob | undefined, err: Error): Promise<void> {
    if (!job) return;
    const final =
      err instanceof UnrecoverableError ||
      err.name === 'UnrecoverableError' ||
      job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!final) return;
    await this.prisma.notification.updateMany({
      where: { id: job.data.notificationId, status: { not: 'SENT' } },
      data: { status: 'DEAD' },
    });
    this.metrics.notificationsDead.inc();
    await this.dead.add(
      'dead',
      { notificationId: job.data.notificationId, reason: err.message },
      { removeOnComplete: 1000 },
    );
    // Template and id only: never the address.
    this.logger.warn(
      { notificationId: job.data.notificationId, reason: err.message },
      'Notification dead-lettered',
    );
  }
}
