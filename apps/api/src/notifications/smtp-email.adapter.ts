import { Inject, Injectable, type OnModuleDestroy, Optional } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { NotificationDeliveryError } from './notification-delivery.error';
import { type NotificationMessage, type NotificationPort } from './notification.port';
import { renderEmail } from './templates';

/** Optional transport override (tests); production builds one from SMTP_* settings. */
export const SMTP_TRANSPORT = Symbol('SMTP_TRANSPORT');

/** Sends email over SMTP (Mailpit in development; provider TBD in production). */
@Injectable()
export class SmtpEmailAdapter implements NotificationPort, OnModuleDestroy {
  private readonly transport: Transporter;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(SMTP_TRANSPORT) transport?: Transporter,
  ) {
    this.transport =
      transport ??
      createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: false,
      });
  }

  async send(message: NotificationMessage): Promise<void> {
    const { subject, text } = renderEmail(message);
    try {
      await this.transport.sendMail({ from: this.config.SMTP_FROM, to: message.to, subject, text });
    } catch (err) {
      // Never let the transport error escape: it can contain the recipient address.
      throw NotificationDeliveryError.from(message.template, err);
    }
  }

  onModuleDestroy(): void {
    this.transport.close();
  }
}
