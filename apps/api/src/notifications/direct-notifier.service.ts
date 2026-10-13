import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDeliveryError } from './notification-delivery.error';
import {
  NOTIFICATION_PORT,
  type NotificationMessage,
  type NotificationPort,
  type SendResult,
} from './notification.port';

/**
 * Codes and invitations are sent at once, never through the outbox or job data (they carry
 * one-time secrets and the user is waiting). Each send is still logged as a Notification row,
 * with the template and outcome only: never the code, link or address.
 */
@Injectable()
export class DirectNotifier implements NotificationPort {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATION_PORT) private readonly port: NotificationPort,
  ) {}

  async send(message: NotificationMessage): Promise<SendResult> {
    try {
      const result = await this.port.send(message);
      await this.log(message, 'SENT', result.providerMessageId ?? null, null);
      return result;
    } catch (err) {
      const safe =
        err instanceof NotificationDeliveryError
          ? err
          : NotificationDeliveryError.from(message.template, err);
      await this.log(message, 'FAILED', null, safe.transportCode ?? 'SEND_FAILED');
      throw safe;
    }
  }

  private async log(
    message: NotificationMessage,
    status: 'SENT' | 'FAILED',
    providerMessageId: string | null,
    lastError: string | null,
  ): Promise<void> {
    // Invitations and new-address codes go to addresses with no account yet: nothing to log against.
    const user = await this.prisma.user.findUnique({
      where: { email: message.to.toLowerCase() },
      select: { id: true },
    });
    if (!user) return;
    await this.prisma.notification.create({
      data: {
        userId: user.id,
        template: message.template,
        mandatory: true,
        status,
        attempts: 1,
        providerMessageId,
        lastError,
        ...(status === 'SENT' && { sentAt: new Date() }),
      },
    });
  }
}
