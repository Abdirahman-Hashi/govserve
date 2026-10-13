import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { type Job, Queue } from 'bullmq';
import { PurgeService } from './purge.service';

export const MAINTENANCE_QUEUE = 'maintenance';
export const PURGE_JOB = 'purge-auth';

/** Daily retention work (ADR-0005: BullMQ repeatable jobs). */
@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor extends WorkerHost {
  constructor(private readonly purge: PurgeService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== PURGE_JOB) return;
    await this.purge.purgeUnverifiedCitizens();
    await this.purge.pruneAuthArtifacts();
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
