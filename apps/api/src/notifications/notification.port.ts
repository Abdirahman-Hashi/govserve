import { type NotificationTemplate } from '@govserve/shared';

export type { NotificationTemplate };

/**
 * Channel-agnostic notification port (DECISIONS: email now, SMS later without changing callers).
 * Messages carry a template and variables; adapters render them for their channel.
 * Variables must not contain PII beyond the first name (FR-101).
 */
export interface NotificationMessage {
  to: string;
  template: NotificationTemplate;
  vars: Record<string, string>;
}

export interface SendResult {
  providerMessageId?: string;
}

export interface NotificationPort {
  send(message: NotificationMessage): Promise<SendResult>;
}

export const NOTIFICATION_PORT = Symbol('NOTIFICATION_PORT');
