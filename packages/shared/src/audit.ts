import { z } from 'zod';

/** Filters for the read-only audit viewer (FR-132). Supervisors only ever see their department. */
export const AuditQuerySchema = z
  .strictObject({
    entityType: z
      .string()
      .regex(/^[A-Za-z]{2,40}$/)
      .optional(),
    entityId: z.string().trim().min(1).max(100).optional(),
    actorId: z.uuid().optional(),
    action: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{2,60}$/)
      .optional(),
    departmentId: z.uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    cursor: z
      .string()
      .regex(/^\d{1,19}$/)
      .optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'The start date must be on or before the end date',
    path: ['to'],
  });
export type AuditQuery = z.infer<typeof AuditQuerySchema>;

export const AuditEntrySchema = z.object({
  chainSeq: z.string(),
  occurredAt: z.iso.datetime(),
  actorId: z.uuid().nullable(),
  actorName: z.string().nullable(),
  actorRole: z.string().nullable(),
  actorType: z.enum(['USER', 'SYSTEM', 'PUBLIC']),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  departmentId: z.uuid().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable(),
  /** SHA-256 of the previous hash and this row, hex (ADR-0010). */
  hash: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditPageSchema = z.object({
  items: z.array(AuditEntrySchema),
  /** Older entries: pass back as `cursor`. */
  nextCursor: z.string().nullable(),
});
export type AuditPage = z.infer<typeof AuditPageSchema>;

export const AuditVerificationSchema = z.object({
  ok: z.boolean(),
  rows: z.number().int(),
  verifiedAt: z.iso.datetime(),
  /** The first broken link, in chain order. */
  broken: z
    .object({
      chainSeq: z.string(),
      problem: z.enum(['LINK_BROKEN', 'ROW_CHANGED', 'TAIL_REMOVED']),
    })
    .nullable(),
});
export type AuditVerification = z.infer<typeof AuditVerificationSchema>;
