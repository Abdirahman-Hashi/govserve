import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { DOCUMENTS_QUEUE, MAINTENANCE_QUEUE } from '../common/queue-names';
import { NOTIFY_DEAD_QUEUE, NOTIFY_QUEUE, OUTBOX_QUEUE } from '../notifications/queues';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Global()
@Module({
  imports: [
    BullModule.registerQueue(
      { name: DOCUMENTS_QUEUE },
      { name: MAINTENANCE_QUEUE },
      { name: OUTBOX_QUEUE },
      { name: NOTIFY_QUEUE },
      { name: NOTIFY_DEAD_QUEUE },
    ),
  ],
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
