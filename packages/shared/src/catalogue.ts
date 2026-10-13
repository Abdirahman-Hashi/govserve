import { z } from 'zod';
import { DepartmentCodes } from './auth.js';
import { FormSchemaDefinition, UiSchemaDefinition } from './forms.js';

/** Money in JSON: a non-negative integer number of cents as a string (bigint-safe). */
export const CentsStringSchema = z
  .string()
  .regex(/^\d{1,12}$/, 'Enter an amount in cents, e.g. 1500 for $15.00');

export const InPersonSteps = ['NONE', 'FINGERPRINTS', 'APPEARANCE'] as const;
export const ApprovalModes = ['SINGLE', 'SUPERVISOR_SECOND', 'SUPERVISOR_ON_RECORD_FOUND'] as const;
export const SubjectModes = ['SELF', 'SELF_OR_CHILD'] as const;
export const VersionStatuses = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;
export const MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const ServiceCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{2,39}$/, 'Use UPPER_SNAKE_CASE, e.g. PROOF_OF_ADDRESS');

/** A document the applicant uploads (Phase 04). Documents sharing a oneOfGroup: any one is enough. */
export const RequiredDocumentSchema = z.strictObject({
  type: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Use UPPER_SNAKE_CASE'),
  label: z.string().trim().min(2).max(120),
  description: z.string().max(300).optional(),
  mime: z.array(z.enum(MIME_TYPES)).min(1),
  maxBytes: z.number().int().min(1024).max(MAX_UPLOAD_BYTES),
  required: z.boolean(),
  oneOfGroup: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{1,39}$/)
    .optional(),
});
export type RequiredDocument = z.infer<typeof RequiredDocumentSchema>;

export const RequiredDocumentsSchema = z
  .array(RequiredDocumentSchema)
  .max(20)
  .refine(
    (docs) => new Set(docs.map((d) => d.type)).size === docs.length,
    'Each document type must be unique',
  );

export const FeeRuleSchema = z.strictObject({
  baseCents: CentsStringSchema,
  perCopyCents: CentsStringSchema,
});
export type FeeRuleJson = z.infer<typeof FeeRuleSchema>;

// ─── Public catalogue ────────────────────────────────────────────────────────

export const CatalogueServiceSummarySchema = z.object({
  code: z.string(),
  name: z.string(),
  description: z.string(),
  departmentCode: z.enum(DepartmentCodes),
  slaWorkingDays: z.number().int(),
  fee: FeeRuleSchema,
  /** True while the fee is a placeholder awaiting official confirmation (O-1). */
  feeProvisional: z.boolean(),
});
export type CatalogueServiceSummary = z.infer<typeof CatalogueServiceSummarySchema>;

export const CatalogueServiceDetailSchema = CatalogueServiceSummarySchema.extend({
  versionId: z.uuid(),
  versionNo: z.number().int(),
  inPersonStep: z.enum(InPersonSteps),
  subjectMode: z.enum(SubjectModes),
  validityMonths: z.number().int().nullable(),
  formSchema: FormSchemaDefinition,
  uiSchema: UiSchemaDefinition,
  requiredDocuments: z.array(RequiredDocumentSchema),
});
export type CatalogueServiceDetail = z.infer<typeof CatalogueServiceDetailSchema>;

// ─── Admin ───────────────────────────────────────────────────────────────────

const serviceFields = {
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(2000),
  active: z.boolean(),
  slaWorkingDays: z.number().int().min(1).max(365),
  inPersonStep: z.enum(InPersonSteps),
  approvalMode: z.enum(ApprovalModes),
  validityMonths: z.number().int().min(1).max(120).nullable(),
  subjectMode: z.enum(SubjectModes),
};

export const CreateServiceRequestSchema = z.strictObject({
  code: ServiceCodeSchema,
  departmentCode: z.enum(DepartmentCodes),
  certificatePrefix: z.string().regex(/^[A-Z]{2,5}$/, 'Use 2–5 capital letters'),
  ...serviceFields,
});
export type CreateServiceRequest = z.infer<typeof CreateServiceRequestSchema>;

/** Code, department and certificate prefix are fixed once a service exists. */
export const UpdateServiceRequestSchema = z
  .strictObject(serviceFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one field');
export type UpdateServiceRequest = z.infer<typeof UpdateServiceRequestSchema>;

export const AdminServiceSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  departmentCode: z.enum(DepartmentCodes),
  certificatePrefix: z.string(),
  ...serviceFields,
  publishedVersionNo: z.number().int().nullable(),
  draftVersionId: z.uuid().nullable(),
  feeIsTest: z.boolean().nullable(),
});
export type AdminService = z.infer<typeof AdminServiceSchema>;

export const UpdateVersionRequestSchema = z
  .strictObject({
    formSchema: z.unknown(),
    uiSchema: z.unknown(),
    requiredDocuments: RequiredDocumentsSchema,
    fee: FeeRuleSchema,
    feeIsTest: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one field');
export type UpdateVersionRequest = z.infer<typeof UpdateVersionRequestSchema>;

export const ServiceVersionSchema = z.object({
  id: z.uuid(),
  serviceId: z.uuid(),
  versionNo: z.number().int(),
  status: z.enum(VersionStatuses),
  /** Drafts may hold work-in-progress definitions, so these are not narrowed here. */
  formSchema: z.record(z.string(), z.unknown()),
  uiSchema: z.record(z.string(), z.unknown()),
  requiredDocuments: z.array(RequiredDocumentSchema),
  fee: FeeRuleSchema,
  feeIsTest: z.boolean(),
  publishedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ServiceVersion = z.infer<typeof ServiceVersionSchema>;

// ─── Settings, holidays, reason codes ───────────────────────────────────────

export const Weekdays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

/** Every setting and the schema its value must satisfy. Unknown keys are rejected. */
export const SettingSchemas = {
  'payment.supervisorThresholdCents': CentsStringSchema,
  'payment.unpaidAbandonDays': z.number().int().min(1).max(365),
  'correction.deadlineDays': z.number().int().min(1).max(365),
  'correction.maxRounds': z.number().int().min(1).max(10),
  'claim.expiryWorkingDays': z.number().int().min(1).max(30),
  'appointment.maxReschedules': z.number().int().min(0).max(10),
  'retention.documentYears': z.number().int().min(1).max(50),
  'retention.draftDays': z.number().int().min(7).max(3650),
  'calendar.workingWeek': z
    .array(z.enum(Weekdays))
    .min(1)
    .max(7)
    .refine((d) => new Set(d).size === d.length, 'List each day once'),
} as const;
export type SettingKey = keyof typeof SettingSchemas;
export const SETTING_KEYS = Object.keys(SettingSchemas) as SettingKey[];

export const SETTING_DEFAULTS: { [K in SettingKey]: z.infer<(typeof SettingSchemas)[K]> } = {
  'payment.supervisorThresholdCents': '10000',
  'payment.unpaidAbandonDays': 30,
  'correction.deadlineDays': 30,
  'correction.maxRounds': 3,
  'claim.expiryWorkingDays': 2,
  'appointment.maxReschedules': 2,
  'retention.documentYears': 7,
  'retention.draftDays': 90,
  'calendar.workingWeek': ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU'],
};

export const SettingSchema = z.object({
  key: z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]),
  value: z.unknown(),
  updatedAt: z.iso.datetime(),
});
export type Setting = z.infer<typeof SettingSchema>;

export const UpdateSettingRequestSchema = z.strictObject({ value: z.unknown() });

export const HolidaySchema = z.object({ date: z.iso.date(), name: z.string() });
export type Holiday = z.infer<typeof HolidaySchema>;
export const CreateHolidayRequestSchema = z.strictObject({
  date: z.iso.date('Use the format YYYY-MM-DD'),
  name: z.string().trim().min(2).max(120),
});
export type CreateHolidayRequest = z.infer<typeof CreateHolidayRequestSchema>;

export const ReasonCodeKinds = ['REJECT', 'PAYMENT_REJECT', 'REVOKE', 'REFUND_DECLINE'] as const;
export const ReasonCodeSchema = z.object({
  id: z.uuid(),
  kind: z.enum(ReasonCodeKinds),
  code: z.string(),
  label: z.string(),
  active: z.boolean(),
});
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;
export const CreateReasonCodeRequestSchema = z.strictObject({
  kind: z.enum(ReasonCodeKinds),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Use UPPER_SNAKE_CASE'),
  label: z.string().trim().min(3).max(120),
});
export type CreateReasonCodeRequest = z.infer<typeof CreateReasonCodeRequestSchema>;
export const UpdateReasonCodeRequestSchema = z
  .strictObject({ label: z.string().trim().min(3).max(120), active: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one field');
export type UpdateReasonCodeRequest = z.infer<typeof UpdateReasonCodeRequestSchema>;
