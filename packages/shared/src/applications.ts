import { z } from 'zod';
import { ApplicationStatus } from './enums.js';
import {
  FeeRuleSchema,
  MAX_UPLOAD_BYTES,
  MIME_TYPES,
  RequiredDocumentSchema,
  type RequiredDocument,
} from './catalogue.js';
import { FormSchemaDefinition, UiSchemaDefinition } from './forms.js';
import { PaymentSchema } from './payments.js';

const statuses = Object.values(ApplicationStatus) as [ApplicationStatus, ...ApplicationStatus[]];
export const DocumentStatuses = [
  'PENDING_UPLOAD',
  'QUARANTINED',
  'CLEAN',
  'INFECTED',
  'REJECTED',
] as const;
export type DocumentStatus = (typeof DocumentStatuses)[number];
export const ApplicationActions = ['EDIT', 'SUBMIT', 'DELETE', 'WITHDRAW', 'RESUBMIT'] as const;
export type ApplicationAction = (typeof ApplicationActions)[number];

// ─── Requests ────────────────────────────────────────────────────────────────

export const CreateApplicationRequestSchema = z.strictObject({
  serviceCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,39}$/),
});
export type CreateApplicationRequest = z.infer<typeof CreateApplicationRequestSchema>;

/** Autosave: values are checked fully on submit; here only names and basic shapes. */
export const UpdateApplicationRequestSchema = z
  .strictObject({
    formData: z.record(
      z.string().max(40),
      z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]),
    ),
    extraCopies: z.number().int().min(0).max(5),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one field');
export type UpdateApplicationRequest = z.infer<typeof UpdateApplicationRequestSchema>;

export const Sha256HexSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'SHA-256 as 64 lowercase hex characters');

export const RequestUploadRequestSchema = z.strictObject({
  docType: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
  fileName: z.string().trim().min(1).max(200),
  mime: z.enum(MIME_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_UPLOAD_BYTES, 'Files can be at most 5 MB'),
  sha256: Sha256HexSchema,
});
export type RequestUploadRequest = z.infer<typeof RequestUploadRequestSchema>;

/** Payment evidence (screenshot / slip photo): same checks, the type is implied. */
export const RequestEvidenceUploadRequestSchema = RequestUploadRequestSchema.omit({
  docType: true,
});
export type RequestEvidenceUploadRequest = z.infer<typeof RequestEvidenceUploadRequestSchema>;

// ─── Responses ───────────────────────────────────────────────────────────────

export const DocumentSchema = z.object({
  id: z.uuid(),
  docType: z.string(),
  originalName: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int(),
  status: z.enum(DocumentStatuses),
  statusReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** The stored file was deleted under the retention policy; the record remains (FR-150). */
  purged: z.boolean(),
});
export type DocumentDto = z.infer<typeof DocumentSchema>;

export const UploadTicketSchema = z.object({
  document: DocumentSchema,
  uploadUrl: z.url(),
  /** Headers the browser must send with the PUT (they are part of the signature). */
  headers: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime(),
});
export type UploadTicket = z.infer<typeof UploadTicketSchema>;

export const DownloadTicketSchema = z.object({ url: z.url(), expiresAt: z.iso.datetime() });
export type DownloadTicket = z.infer<typeof DownloadTicketSchema>;

export const ApplicationSummarySchema = z.object({
  id: z.uuid(),
  referenceNo: z.string().nullable(),
  serviceCode: z.string(),
  serviceName: z.string(),
  status: z.enum(statuses),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  submittedAt: z.iso.datetime().nullable(),
});
export type ApplicationSummary = z.infer<typeof ApplicationSummarySchema>;

export const FeeLineJsonSchema = z.object({
  code: z.enum(['BASE', 'COPY']),
  qty: z.number().int(),
  unitCents: z.string(),
  amountCents: z.string(),
});

export const ApplicationDetailSchema = ApplicationSummarySchema.extend({
  kind: z.enum(['STANDARD', 'DUPLICATE']),
  extraCopies: z.number().int(),
  serviceVersionId: z.uuid(),
  formSchema: FormSchemaDefinition,
  uiSchema: UiSchemaDefinition,
  requiredDocuments: z.array(RequiredDocumentSchema),
  fee: FeeRuleSchema,
  feeProvisional: z.boolean(),
  formData: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  documents: z.array(DocumentSchema),
  history: z.array(
    z.object({
      fromStatus: z.enum(statuses).nullable(),
      toStatus: z.enum(statuses),
      at: z.iso.datetime(),
      note: z.string().nullable(),
    }),
  ),
  feeAssessment: z.object({ lines: z.array(FeeLineJsonSchema), totalCents: z.string() }).nullable(),
  /** Payments made towards this application, newest first. */
  payments: z.array(PaymentSchema),
  /** Sum of CONFIRMED payments and what is still owed (cents as strings; '0' before assessment). */
  paidCents: z.string(),
  balanceCents: z.string(),
  /** In-person appointments (scheduled ones show time and place). */
  appointments: z.array(
    z.object({
      kind: z.enum(['FINGERPRINTS', 'APPEARANCE']),
      scheduledAt: z.iso.datetime(),
      location: z.string(),
      status: z.enum(['SCHEDULED', 'ATTENDED', 'NO_SHOW', 'CANCELLED']),
    }),
  ),
  /** The certificate issued for this application, if any. */
  certificate: z
    .object({
      id: z.uuid(),
      certificateNo: z.string(),
      status: z.enum(['VALID', 'EXPIRED', 'REVOKED']),
      issuedAt: z.iso.datetime(),
      expiresAt: z.iso.datetime().nullable(),
    })
    .nullable(),
  /** What the caller may do now; decided by the server (the UI only shows or hides buttons). */
  allowedActions: z.array(z.enum(ApplicationActions)),
  /** During corrections, only these fields/documents can change; null means all (draft). */
  editableFields: z.array(z.string()).nullable(),
  editableDocTypes: z.array(z.string()).nullable(),
  correction: z
    .object({
      round: z.number().int(),
      dueAt: z.iso.datetime(),
      items: z.array(
        z.object({ kind: z.enum(['FIELD', 'DOCUMENT']), target: z.string(), comment: z.string() }),
      ),
    })
    .nullable(),
});
export type ApplicationDetail = z.infer<typeof ApplicationDetailSchema>;

// ─── Document completeness (FR-033) ─────────────────────────────────────────

export interface DocumentCompleteness {
  ok: boolean;
  /** Required document types (or "any one of" group names) with no usable upload. */
  missing: string[];
  /** Uploaded but not yet CLEAN (still uploading, being scanned, infected or rejected). */
  notReady: string[];
}

/**
 * Checks the current (non-superseded) uploads against a version's required documents.
 * A one-of group is satisfied by any CLEAN member. The API is authoritative; the web uses
 * this only to show the checklist.
 */
export function documentCompleteness(
  required: RequiredDocument[],
  uploads: { docType: string; status: DocumentStatus }[],
): DocumentCompleteness {
  const clean = new Set(uploads.filter((u) => u.status === 'CLEAN').map((u) => u.docType));
  const present = new Set(uploads.map((u) => u.docType));
  const missing: string[] = [];
  const notReady: string[] = [];
  const groups = new Map<string, RequiredDocument[]>();
  for (const doc of required) {
    if (doc.oneOfGroup) {
      groups.set(doc.oneOfGroup, [...(groups.get(doc.oneOfGroup) ?? []), doc]);
      continue;
    }
    if (present.has(doc.type) && !clean.has(doc.type)) notReady.push(doc.type);
    else if (doc.required && !clean.has(doc.type)) missing.push(doc.type);
  }
  for (const [group, members] of groups) {
    if (members.some((m) => clean.has(m.type))) continue;
    const pending = members.filter((m) => present.has(m.type)).map((m) => m.type);
    if (pending.length > 0) notReady.push(...pending);
    else if (members.some((m) => m.required)) missing.push(group);
  }
  return { ok: missing.length === 0 && notReady.length === 0, missing, notReady };
}
