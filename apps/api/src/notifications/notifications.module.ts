import { Global, Module } from '@nestjs/common';
import { DirectNotifier } from './direct-notifier.service';
import { NOTIFICATION_PORT } from './notification.port';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { SmtpEmailAdapter } from './smtp-email.adapter';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    { provide: NOTIFICATION_PORT, useClass: SmtpEmailAdapter },
    DirectNotifier,
    NotificationsService,
  ],
  exports: [NOTIFICATION_PORT, DirectNotifier],
})
export class NotificationsModule {}
