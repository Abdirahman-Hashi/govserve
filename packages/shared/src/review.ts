import { z } from 'zod';
import { ApplicationStatus } from './enums.js';
import { DocumentSchema, FeeLineJsonSchema } from './applications.js';
import { FormSchemaDefinition, UiSchemaDefinition } from './forms.js';
import { PaymentSchema } from './payments.js';
import { RequiredDocumentSchema } from './catalogue.js';

const statuses = Object.values(ApplicationStatus) as [ApplicationStatus, ...ApplicationStatus[]];
export const SlaRisks = ['ON_TRACK', 'AT_RISK', 'OVERDUE', 'PAUSED', 'NONE'] as const;
export type SlaRisk = (typeof SlaRisks)[number];
export const RevokeReasons = ['FRAUD', 'ERROR', 'CHARGEBACK'] as const;
export const StaffActions = [
  'CLAIM',
  'RELEASE',
  'ASSIGN',
  'REQUEST_CORRECTION',
  'SCHEDULE_APPOINTMENT',
  'RECORD_APPOINTMENT',
  'APPROVE',
  'REFER',
  'REJECT',
  'SECOND_APPROVE',
  'CONFIRM_REFERRAL',
  'RETURN',
  'RESOLVE_CHARGEBACK',
] as const;
export type StaffAction = (typeof StaffActions)[number];

/** SLA progress (FR-080): at risk at 80 %, overdue at 100 %, paused during corrections and appointments. */
export function slaRisk(input: {
  queuedAt: Date | null;
  slaDueAt: Date | null;
  pausedAt: Date | null;
  pausedTotalMs: number;
  now: Date;
}): SlaRisk {
  const { queuedAt, slaDueAt, pausedAt, pausedTotalMs, now } = input;
  if (!queuedAt || !slaDueAt) return 'NONE';
  if (pausedAt) return 'PAUSED';
  const total = slaDueAt.getTime() - queuedAt.getTime() - pausedTotalMs;
  const used = now.getTime() - queuedAt.getTime() - pausedTotalMs;
  if (total <= 0 || used >= total) return 'OVERDUE';
  return used / total >= 0.8 ? 'AT_RISK' : 'ON_TRACK';
}

// ─── Queue ───────────────────────────────────────────────────────────────────

export const QueueItemSchema = z.object({
  id: z.uuid(),
  referenceNo: z.string().nullable(),
  serviceCode: z.string(),
  serviceName: z.string(),
  applicantName: z.string(),
  status: z.enum(statuses),
  assigneeId: z.uuid().nullable(),
  assigneeName: z.string().nullable(),
  submittedAt: z.iso.datetime().nullable(),
  slaDueAt: z.iso.datetime().nullable(),
  slaRisk: z.enum(SlaRisks),
  chargebackFlag: z.boolean(),
});
export type QueueItem = z.infer<typeof QueueItemSchema>;

export const QueueQuerySchema = z.strictObject({
  status: z.enum(statuses).optional(),
  service: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{2,39}$/)
    .optional(),
  risk: z.enum(SlaRisks).optional(),
  assignee: z.union([z.literal('me'), z.literal('unassigned'), z.uuid()]).optional(),
});
export type QueueQuery = z.infer<typeof QueueQuerySchema>;

// ─── Review detail ──────────────────────────────────────────────────────────

export const AppointmentSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['FINGERPRINTS', 'APPEARANCE']),
  scheduledAt: z.iso.datetime(),
  location: z.string(),
  status: z.enum(['SCHEDULED', 'ATTENDED', 'NO_SHOW', 'CANCELLED']),
  attendees: z.array(z.object({ name: z.string(), role: z.string() })).nullable(),
  rescheduleCount: z.number().int(),
});
export type AppointmentDto = z.infer<typeof AppointmentSchema>;

export const DecisionSchema = z.object({
  level: z.enum(['OFFICER', 'SUPERVISOR']),
  decision: z.enum(['APPROVE', 'FORWARD', 'RETURN', 'REJECT', 'REFER']),
  outcome: z.enum(['NO_RECORD', 'RECORD_FOUND']).nullable(),
  note: z.string().nullable(),
  decidedById: z.uuid(),
  decidedByName: z.string(),
  decidedAt: z.iso.datetime(),
});

export const CertificateSummarySchema = z.object({
  id: z.uuid(),
  certificateNo: z.string(),
  serviceName: z.string(),
  holderName: z.string(),
  issuedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
  status: z.enum(['VALID', 'EXPIRED', 'REVOKED']),
  revokeReason: z.enum(['FRAUD', 'ERROR', 'CHARGEBACK', 'SUPERSEDED']).nullable(),
  isDuplicate: z.boolean(),
});
export type CertificateSummary = z.infer<typeof CertificateSummarySchema>;

export const StaffApplicationSchema = z.object({
  id: z.uuid(),
  referenceNo: z.string().nullable(),
  kind: z.enum(['STANDARD', 'DUPLICATE']),
  serviceCode: z.string(),
  serviceName: z.string(),
  approvalMode: z.enum(['SINGLE', 'SUPERVISOR_SECOND', 'SUPERVISOR_ON_RECORD_FOUND']),
  inPersonStep: z.enum(['NONE', 'FINGERPRINTS', 'APPEARANCE']),
  status: z.enum(statuses),
  version: z.number().int(),
  applicantName: z.string(),
  subjectType: z.enum(['SELF', 'CHILD']).nullable(),
  relationship: z.enum(['SELF', 'MOTHER', 'FATHER', 'GUARDIAN']).nullable(),
  assigneeId: z.uuid().nullable(),
  assigneeName: z.string().nullable(),
  claimExpiresAt: z.iso.datetime().nullable(),
  submittedAt: z.iso.datetime().nullable(),
  slaDueAt: z.iso.datetime().nullable(),
  slaRisk: z.enum(SlaRisks),
  correctionRound: z.number().int(),
  chargebackFlag: z.boolean(),
  formSchema: FormSchemaDefinition,
  uiSchema: UiSchemaDefinition,
  /** Answers with personal fields masked ("••••") unless unmasked (audited). */
  formData: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  maskedFields: z.array(z.string()),
  requiredDocuments: z.array(RequiredDocumentSchema),
  documents: z.array(DocumentSchema),
  feeAssessment: z.object({ lines: z.array(FeeLineJsonSchema), totalCents: z.string() }).nullable(),
  payments: z.array(PaymentSchema),
  paidCents: z.string(),
  history: z.array(
    z.object({
      fromStatus: z.enum(statuses).nullable(),
      toStatus: z.enum(statuses),
      at: z.iso.datetime(),
      note: z.string().nullable(),
      actorName: z.string().nullable(),
    }),
  ),
  appointments: z.array(AppointmentSchema),
  decisions: z.array(DecisionSchema),
  corrections: z.array(
    z.object({
      round: z.number().int(),
      dueAt: z.iso.datetime(),
      resolvedAt: z.iso.datetime().nullable(),
      items: z.array(
        z.object({ kind: z.enum(['FIELD', 'DOCUMENT']), target: z.string(), comment: z.string() }),
      ),
    }),
  ),
  certificate: CertificateSummarySchema.nullable(),
  /** What the caller may do now (decided by the server). */
  allowedActions: z.array(z.enum(StaffActions)),
  /** Why approval is blocked, if it is (FR-075). */
  approvalBlockers: z.array(z.string()),
});
export type StaffApplication = z.infer<typeof StaffApplicationSchema>;

export const UnmaskedSchema = z.object({
  formData: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

// ─── Staff requests ─────────────────────────────────────────────────────────

const Version = { version: z.number().int().min(0) };

export const VersionOnlySchema = z.strictObject(Version);
export type VersionOnly = z.infer<typeof VersionOnlySchema>;

export const AssignRequestSchema = z.strictObject({ ...Version, officerId: z.uuid() });
export type AssignRequest = z.infer<typeof AssignRequestSchema>;

export const RequestCorrectionRequestSchema = z.strictObject({
  ...Version,
  items: z
    .array(
      z.strictObject({
        kind: z.enum(['FIELD', 'DOCUMENT']),
        target: z.string().min(1).max(60),
        comment: z.string().trim().min(5, 'Explain what to correct').max(500),
      }),
    )
    .min(1, 'Flag at least one field or document')
    .max(30),
});
export type RequestCorrectionRequest = z.infer<typeof RequestCorrectionRequestSchema>;

export const ScheduleAppointmentRequestSchema = z.strictObject({
  ...Version,
  scheduledAt: z.iso.datetime({ offset: true }),
  location: z.string().trim().min(3).max(200),
});
export type ScheduleAppointmentRequest = z.infer<typeof ScheduleAppointmentRequestSchema>;

export const RecordAppointmentRequestSchema = z.strictObject({
  ...Version,
  outcome: z.enum(['ATTENDED', 'NO_SHOW']),
  attendees: z
    .array(
      z.strictObject({
        name: z.string().trim().min(2).max(120),
        role: z.string().trim().min(2).max(40),
      }),
    )
    .max(10)
    .optional(),
});
export type RecordAppointmentRequest = z.infer<typeof RecordAppointmentRequestSchema>;

export const ReferRequestSchema = z.strictObject({
  ...Version,
  note: z.string().trim().min(5).max(2000),
});
export type ReferRequest = z.infer<typeof ReferRequestSchema>;
export const ReturnRequestSchema = z.strictObject({
  ...Version,
  note: z.string().trim().min(5).max(500),
});
export type ReturnRequest = z.infer<typeof ReturnRequestSchema>;
export const RejectApplicationRequestSchema = z.strictObject({
  ...Version,
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
  note: z.string().trim().min(5, 'Explain the decision to the citizen').max(500),
});
export type RejectApplicationRequest = z.infer<typeof RejectApplicationRequestSchema>;

export const ResolveChargebackRequestSchema = z.strictObject({
  ...Version,
  decision: z.enum(['KEEP', 'REVOKE']),
  note: z.string().trim().min(5).max(500),
});
export type ResolveChargebackRequest = z.infer<typeof ResolveChargebackRequestSchema>;

export const RevokeCertificateRequestSchema = z.strictObject({
  reason: z.enum(RevokeReasons),
  note: z.string().trim().min(5).max(500),
});
export type RevokeCertificateRequest = z.infer<typeof RevokeCertificateRequestSchema>;

export const OrderDuplicateRequestSchema = z.strictObject({
  copies: z.number().int().min(1).max(5),
});
export type OrderDuplicateRequest = z.infer<typeof OrderDuplicateRequestSchema>;

// ─── Public certificate verification ────────────────────────────────────────

export const CertificatePayloadSchema = z.strictObject({
  t: z.literal('CERT'),
  no: z.string(),
  svc: z.string(),
  iss: z.iso.datetime(),
  exp: z.iso.datetime().optional(),
  h: z.string(),
  kid: z.string(),
});
export type CertificatePayload = z.infer<typeof CertificatePayloadSchema>;

export const PublicCertificateSchema = z.object({
  certificateNo: z.string(),
  serviceName: z.string(),
  status: z.enum(['VALID', 'EXPIRED', 'REVOKED']),
  issuedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  holderNameMasked: z.string(),
  payload: CertificatePayloadSchema,
});
export type PublicCertificate = z.infer<typeof PublicCertificateSchema>;

export const NameCheckRequestSchema = z.strictObject({ name: z.string().trim().min(2).max(120) });
export type NameCheckRequest = z.infer<typeof NameCheckRequestSchema>;
export const NameCheckResponseSchema = z.object({ match: z.boolean() });

/** Case-, accent-spacing- and punctuation-insensitive comparison key for names. */
export function normaliseName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
