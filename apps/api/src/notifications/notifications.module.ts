import { Global, Module } from '@nestjs/common';
import { NOTIFICATION_PORT } from './notification.port';
import { SmtpEmailAdapter } from './smtp-email.adapter';

@Global()
@Module({
  providers: [{ provide: NOTIFICATION_PORT, useClass: SmtpEmailAdapter }],
  exports: [NOTIFICATION_PORT],
})
export class NotificationsModule {}
