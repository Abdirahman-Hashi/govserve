/**
 * Channel-agnostic notification port (DECISIONS: email now, SMS later without changing callers).
 * Messages carry a template and variables; adapters render them for their channel.
 * Variables must not contain PII beyond the first name (FR-101).
 */
export type NotificationTemplate =
  | 'VERIFY_EMAIL_CODE'
  | 'CHANGE_EMAIL_CODE'
  | 'RESET_PASSWORD_CODE'
  | 'STAFF_DEVICE_CODE'
  | 'STAFF_INVITATION';

export interface NotificationMessage {
  to: string;
  template: NotificationTemplate;
  vars: Record<string, string>;
}

export interface NotificationPort {
  send(message: NotificationMessage): Promise<void>;
}

export const NOTIFICATION_PORT = Symbol('NOTIFICATION_PORT');
