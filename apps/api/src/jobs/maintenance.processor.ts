import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { type Job, Queue } from 'bullmq';
import { ApplicationsService } from '../applications/applications.service';
import { ConfigAdminService } from '../config-admin/config-admin.service';
import { PurgeService } from './purge.service';

export const MAINTENANCE_QUEUE = 'maintenance';
export const PURGE_JOB = 'purge-auth';

/** Daily retention work (ADR-0005: BullMQ repeatable jobs). */
@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor extends WorkerHost {
  constructor(
    private readonly purge: PurgeService,
    private readonly applications: ApplicationsService,
    private readonly settings: ConfigAdminService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
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
      PURGE_JOB,
      { pattern: '30 2 * * *', tz: 'Africa/Mogadishu' },
      { name: PURGE_JOB },
    );
  }
}
