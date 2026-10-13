import {
  type NotificationMessage,
  type NotificationPort,
  type SendResult,
} from './notification.port';

/** Test adapter: records messages instead of sending them. */
export class InMemoryNotificationAdapter implements NotificationPort {
  readonly sent: NotificationMessage[] = [];
  /** Tests make sends fail: return an error to throw, or undefined to deliver. */
  failWith: ((message: NotificationMessage) => Error | undefined) | null = null;

  send(message: NotificationMessage): Promise<SendResult> {
    const err = this.failWith?.(message);
    if (err) return Promise.reject(err);
    this.sent.push(message);
    return Promise.resolve({ providerMessageId: `mem-${this.sent.length}` });
  }

  /** Latest message for a recipient and template, if any. */
  last(to: string, template: NotificationMessage['template']): NotificationMessage | undefined {
    return [...this.sent]
      .reverse()
      .find((m) => m.to.toLowerCase() === to.toLowerCase() && m.template === template);
  }
}
