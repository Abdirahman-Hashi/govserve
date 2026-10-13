import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { type Job, Queue } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { OutboxRelayService } from './outbox-relay.service';
import { OUTBOX_QUEUE, RELAY_JOB } from './queues';

@Processor(OUTBOX_QUEUE)
export class OutboxProcessor extends WorkerHost {
  constructor(private readonly relay: OutboxRelayService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== RELAY_JOB) return;
    // Drain in batches, then pick up anything stuck between commit and enqueue.
    while ((await this.relay.relayBatch()) > 0) {
      /* keep draining */
    }
    await this.relay.sweep();
  }
}

@Injectable()
export class OutboxScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(OUTBOX_QUEUE) private readonly queue: Queue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      RELAY_JOB,
      { every: this.config.OUTBOX_POLL_MS },
      { name: RELAY_JOB, opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }
}
