import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { type Queue } from 'bullmq';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { DOCUMENTS_QUEUE, MAINTENANCE_QUEUE } from '../common/queue-names';
import { NOTIFY_DEAD_QUEUE, NOTIFY_QUEUE, OUTBOX_QUEUE } from '../notifications/queues';

/**
 * Prometheus metrics (NFR-012). Labels never carry ids, references or personal data: routes are
 * the matched pattern (e.g. /api/v1/applications/:id), never the raw URL.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'HTTP requests by method, matched route and status code',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });

  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration by method and matched route',
    labelNames: ['method', 'route'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  readonly webhookFailures = new Counter({
    name: 'payment_webhook_failures_total',
    help: 'Card webhooks rejected (bad signature, bad payload) or failed while processing',
    labelNames: ['reason'] as const,
    registers: [this.registry],
  });

  readonly notificationsDead = new Counter({
    name: 'notifications_dead_total',
    help: 'Notifications that exhausted their retries (dead-lettered)',
    registers: [this.registry],
  });

  readonly auditChainOk = new Gauge({
    name: 'audit_chain_ok',
    help: '1 when the last audit chain verification passed, 0 when it found a break',
    registers: [this.registry],
  });

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @InjectQueue(DOCUMENTS_QUEUE) documents: Queue,
    @InjectQueue(MAINTENANCE_QUEUE) maintenance: Queue,
    @InjectQueue(OUTBOX_QUEUE) outbox: Queue,
    @InjectQueue(NOTIFY_QUEUE) notify: Queue,
    @InjectQueue(NOTIFY_DEAD_QUEUE) dead: Queue,
  ) {
    collectDefaultMetrics({ register: this.registry });
    // Unknown until the first verification of this process.
    this.auditChainOk.set(1);
    new Gauge({
      name: 'govserve_build_info',
      help: 'Release running in this process',
      labelNames: ['release', 'deploy_env'] as const,
      registers: [this.registry],
    }).set({ release: config.APP_VERSION, deploy_env: config.DEPLOY_ENV }, 1);
    const queues = [documents, maintenance, outbox, notify, dead];
    new Gauge({
      name: 'bullmq_jobs',
      help: 'Jobs per queue and state',
      labelNames: ['queue', 'state'] as const,
      registers: [this.registry],
      async collect() {
        this.reset();
        for (const q of queues) {
          const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'failed');
          for (const [state, n] of Object.entries(counts)) this.set({ queue: q.name, state }, n);
        }
      },
    });
    new Gauge({
      name: 'bullmq_oldest_waiting_seconds',
      help: 'Age of the oldest waiting job per queue (0 when empty)',
      labelNames: ['queue'] as const,
      registers: [this.registry],
      async collect() {
        for (const q of queues) {
          const [oldest] = await q.getJobs(['waiting'], 0, 0, true);
          this.set(
            { queue: q.name },
            oldest ? Math.max(0, (Date.now() - oldest.timestamp) / 1000) : 0,
          );
        }
      },
    });
  }
}
