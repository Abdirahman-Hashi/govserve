/**
 * Raised by notification adapters instead of the transport's own error, which can carry
 * recipient addresses (e.g. nodemailer's `rejected` list and SMTP response text). Only
 * non-identifying diagnostics are kept, so the error is safe to log (NFR-003).
 */
export class NotificationDeliveryError extends Error {
  constructor(
    readonly template: string,
    readonly transportCode: string | undefined,
    readonly responseCode: number | undefined,
  ) {
    super(
      `Notification delivery failed (${template}${transportCode ? `, ${transportCode}` : ''}${responseCode ? `, SMTP ${responseCode}` : ''})`,
    );
    this.name = 'NotificationDeliveryError';
  }

  static from(template: string, err: unknown): NotificationDeliveryError {
    const e = (err ?? {}) as { code?: unknown; responseCode?: unknown };
    return new NotificationDeliveryError(
      template,
      typeof e.code === 'string' ? e.code : undefined,
      typeof e.responseCode === 'number' ? e.responseCode : undefined,
    );
  }
}
