import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DeliveryProcessor } from './delivery.processor';
import { OutboxRelayService } from './outbox-relay.service';
import { OutboxProcessor, OutboxScheduler } from './outbox.processor';
import { NOTIFY_DEAD_QUEUE, NOTIFY_QUEUE, OUTBOX_QUEUE } from './queues';

/** Outbox relay and email delivery workers (ADR-0005). */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: OUTBOX_QUEUE },
      { name: NOTIFY_QUEUE },
      { name: NOTIFY_DEAD_QUEUE },
    ),
  ],
  providers: [OutboxRelayService, OutboxProcessor, OutboxScheduler, DeliveryProcessor],
  exports: [OutboxRelayService],
})
export class NotificationJobsModule {}
