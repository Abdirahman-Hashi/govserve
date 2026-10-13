import { type NotificationMessage, type NotificationPort } from './notification.port';

/** Test adapter: records messages instead of sending them. */
export class InMemoryNotificationAdapter implements NotificationPort {
  readonly sent: NotificationMessage[] = [];

  send(message: NotificationMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  /** Latest message for a recipient and template, if any. */
  last(to: string, template: NotificationMessage['template']): NotificationMessage | undefined {
    return [...this.sent]
      .reverse()
      .find((m) => m.to.toLowerCase() === to.toLowerCase() && m.template === template);
  }
}
