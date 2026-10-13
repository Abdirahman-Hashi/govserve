import { z } from 'zod';

/** Messages delivered from outbox events (FR-100). Codes and invitations are sent directly. */
export const EventTemplates = [
  'APPLICATION_SUBMITTED',
  'PAYMENT_RECEIVED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_REJECTED',
  'CORRECTION_REQUESTED',
  'CORRECTION_REMINDER',
  'APPOINTMENT_SCHEDULED',
  'APPOINTMENT_CHANGED',
  'CERTIFICATE_ISSUED',
  'COPY_ISSUED',
  'APPLICATION_REJECTED',
  'APPLICATION_REFERRED',
  'APPLICATION_WITHDRAWN',
  'REFUND_PROCESSED',
  'SLA_BREACHED',
  'AUDIT_CHAIN_BROKEN',
] as const;
export type EventTemplate = (typeof EventTemplates)[number];

/** Sent directly (they carry one-time secrets, so they never pass through the outbox or Redis). */
export const DirectTemplates = [
  'VERIFY_EMAIL_CODE',
  'CHANGE_EMAIL_CODE',
  'RESET_PASSWORD_CODE',
  'STAFF_DEVICE_CODE',
  'STAFF_INVITATION',
] as const;
export type DirectTemplate = (typeof DirectTemplates)[number];

export const NotificationTemplates = [...DirectTemplates, ...EventTemplates] as const;
export type NotificationTemplate = (typeof NotificationTemplates)[number];

/** The only messages a user may opt out of by email (they confirm the user's own action). */
export const OptionalTemplates: readonly EventTemplate[] = [
  'APPLICATION_SUBMITTED',
  'PAYMENT_RECEIVED',
  'APPLICATION_WITHDRAWN',
];

/** Variables stored with a notification: never PII beyond what the email itself may show (FR-101). */
export const NotificationVarsSchema = z.object({
  referenceNo: z.string().optional(),
  applicationId: z.uuid().optional(),
  daysLeft: z.string().optional(),
  dueAt: z.iso.datetime().optional(),
  appointmentAt: z.iso.datetime().optional(),
  location: z.string().optional(),
  chainSeq: z.string().optional(),
});
export type NotificationVars = z.infer<typeof NotificationVarsSchema>;

export const NotificationSchema = z.object({
  id: z.uuid(),
  template: z.enum(NotificationTemplates),
  vars: NotificationVarsSchema,
  /** Where the in-app item links to (portal path), if anywhere. */
  link: z.string().nullable(),
  emailStatus: z.enum(['QUEUED', 'SENT', 'FAILED', 'SKIPPED', 'DEAD']),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
});
export type NotificationDto = z.infer<typeof NotificationSchema>;

export const NotificationPageSchema = z.object({
  items: z.array(NotificationSchema),
  nextCursor: z.string().nullable(),
});
export type NotificationPage = z.infer<typeof NotificationPageSchema>;

export const UnreadCountSchema = z.object({ unread: z.number().int().nonnegative() });

export const NotificationPreferencesSchema = z.strictObject({ emailOptional: z.boolean() });
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;

/** Portal path an in-app notification or email opens (staff alerts open the review page). */
export function linkFor(template: NotificationTemplate, vars: NotificationVars): string | null {
  if (template === 'AUDIT_CHAIN_BROKEN') return '/admin/audit';
  if (!vars.applicationId) return null;
  return template === 'SLA_BREACHED'
    ? `/officer/review/${vars.applicationId}`
    : `/citizen/applications/${vars.applicationId}`;
}
