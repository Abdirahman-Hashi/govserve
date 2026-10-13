import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { type Job, Queue } from 'bullmq';
import { ApplicationsService } from '../applications/applications.service';
import { ConfigAdminService } from '../config-admin/config-admin.service';
import { PaymentsService } from '../payments/payments.service';
import { ReviewService } from '../review/review.service';
import { PurgeService } from './purge.service';

export const MAINTENANCE_QUEUE = 'maintenance';
export const PURGE_JOB = 'purge-auth';
export const RECONCILE_CARD_JOB = 'reconcile-card';
export const ABANDON_UNPAID_JOB = 'abandon-unpaid';
export const EXPIRE_CLAIMS_JOB = 'expire-claims';
export const CORRECTION_DEADLINES_JOB = 'correction-deadlines';

/** Daily retention work (ADR-0005: BullMQ repeatable jobs). */
@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor extends WorkerHost {
  constructor(
    private readonly purge: PurgeService,
    private readonly applications: ApplicationsService,
    private readonly settings: ConfigAdminService,
    private readonly payments: PaymentsService,
    private readonly review: ReviewService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === RECONCILE_CARD_JOB) {
      await this.payments.reconcileCardPayments();
      return;
    }
    if (job.name === ABANDON_UNPAID_JOB) {
      await this.payments.abandonUnpaid();
      return;
    }
    if (job.name === EXPIRE_CLAIMS_JOB) {
      await this.review.expireClaims();
      return;
    }
    if (job.name === CORRECTION_DEADLINES_JOB) {
      await this.review.processCorrectionDeadlines();
      return;
    }
    if (job.name !== PURGE_JOB) return;
    await this.purge.purgeUnverifiedCitizens();
    await this.purge.pruneAuthArtifacts();
    // A4: drafts idle longer than the retention setting are abandoned and their uploads deleted.
    await this.applications.abandonIdleDrafts(await this.settings.get('retention.draftDays'));
  }
}

@Injectable()
export class MaintenanceScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    // Upsert keeps exactly one schedule however many API instances start. 02:30 Mogadishu time.
    await this.queue.upsertJobScheduler(
      RECONCILE_CARD_JOB,
      { every: 15 * 60_000 },
      { name: RECONCILE_CARD_JOB },
    );
    await this.queue.upsertJobScheduler(
      ABANDON_UNPAID_JOB,
      { pattern: '0 3 * * *', tz: 'Africa/Mogadishu' },
      { name: ABANDON_UNPAID_JOB },
    );
    await this.queue.upsertJobScheduler(
      EXPIRE_CLAIMS_JOB,
      { every: 15 * 60_000 },
      { name: EXPIRE_CLAIMS_JOB },
    );
    await this.queue.upsertJobScheduler(
      CORRECTION_DEADLINES_JOB,
      { pattern: '0 6 * * *', tz: 'Africa/Mogadishu' },
      { name: CORRECTION_DEADLINES_JOB },
    );
    await this.queue.upsertJobScheduler(
      PURGE_JOB,
      { pattern: '30 2 * * *', tz: 'Africa/Mogadishu' },
      { name: PURGE_JOB },
    );
  }
}
