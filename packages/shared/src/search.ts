import { z } from 'zod';
import { ApplicationSummarySchema } from './applications.js';
import { ApplicationStatus, PaymentStatus } from './enums.js';
import { PaymentChannels } from './payments.js';

const appStatuses = Object.values(ApplicationStatus) as [ApplicationStatus, ...ApplicationStatus[]];
const payStatuses = Object.values(PaymentStatus) as [PaymentStatus, ...PaymentStatus[]];

/** Opaque keyset cursor issued by the API (base64url of `createdAt|id`). */
export const CursorSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{10,120}$/)
  .optional();
const Day = z.iso.date().optional();
const Service = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{2,39}$/)
  .optional();
const Cents = z
  .string()
  .regex(/^\d{1,12}$/, 'Whole cents')
  .optional();
const fromBeforeTo = (q: { from?: string | undefined; to?: string | undefined }) =>
  !q.from || !q.to || q.from <= q.to;
const range = { message: 'The start date must be on or before the end date', path: ['to'] };

/** Part of a reference or receipt number (at least 3 characters, letters, digits and dashes). */
const NumberFragment = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{3,30}$/, 'Use at least 3 letters, digits or dashes')
  .optional();
/** A full document number: exact match. */
const DocumentNo = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{1,6}-\d{4}-\d{6,}$/, 'Enter the full number, e.g. R-2026-000123')
  .optional();

// ─── Citizen history (FR-110) ───────────────────────────────────────────────

export const MyApplicationsQuerySchema = z
  .strictObject({
    status: z.enum(appStatuses).optional(),
    service: Service,
    from: Day,
    to: Day,
    q: NumberFragment,
    cursor: CursorSchema,
  })
  .refine(fromBeforeTo, range);
export type MyApplicationsQuery = z.infer<typeof MyApplicationsQuerySchema>;

export const ApplicationPageSchema = z.object({
  items: z.array(ApplicationSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ApplicationPage = z.infer<typeof ApplicationPageSchema>;

export const MyPaymentsQuerySchema = z
  .strictObject({
    status: z.enum(payStatuses).optional(),
    from: Day,
    to: Day,
    q: NumberFragment,
    cursor: CursorSchema,
  })
  .refine(fromBeforeTo, range);
export type MyPaymentsQuery = z.infer<typeof MyPaymentsQuerySchema>;

export const PaymentHistoryItemSchema = z.object({
  id: z.uuid(),
  applicationId: z.uuid(),
  referenceNo: z.string().nullable(),
  serviceName: z.string(),
  channel: z.enum(PaymentChannels),
  provider: z.string().nullable(),
  amountCents: z.string(),
  status: z.enum(payStatuses),
  receiptNo: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type PaymentHistoryItem = z.infer<typeof PaymentHistoryItemSchema>;

export const PaymentHistoryPageSchema = z.object({
  items: z.array(PaymentHistoryItemSchema),
  nextCursor: z.string().nullable(),
});
export type PaymentHistoryPage = z.infer<typeof PaymentHistoryPageSchema>;

// ─── Staff search (FR-111, FR-112) ──────────────────────────────────────────

export const StaffApplicationSearchSchema = z
  .strictObject({
    referenceNo: NumberFragment,
    receiptNo: DocumentNo,
    certificateNo: DocumentNo,
    name: z.string().trim().min(2).max(120).optional(),
    nationalId: z.string().trim().min(4).max(30).optional(),
    phone: z.string().trim().min(6).max(30).optional(),
    status: z.enum(appStatuses).optional(),
    service: Service,
    from: Day,
    to: Day,
    cursor: CursorSchema,
  })
  .refine(fromBeforeTo, range);
export type StaffApplicationSearch = z.infer<typeof StaffApplicationSearchSchema>;

export const StaffApplicationHitSchema = z.object({
  id: z.uuid(),
  referenceNo: z.string().nullable(),
  serviceName: z.string(),
  applicantName: z.string(),
  subjectName: z.string().nullable(),
  status: z.enum(appStatuses),
  assigneeName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  submittedAt: z.iso.datetime().nullable(),
});
export type StaffApplicationHit = z.infer<typeof StaffApplicationHitSchema>;

export const StaffApplicationResultsSchema = z.object({
  items: z.array(StaffApplicationHitSchema),
  nextCursor: z.string().nullable(),
});
export type StaffApplicationResults = z.infer<typeof StaffApplicationResultsSchema>;

export const StaffPaymentSearchSchema = z
  .strictObject({
    referenceNo: NumberFragment,
    receiptNo: DocumentNo,
    channel: z.enum(PaymentChannels).optional(),
    status: z.enum(payStatuses).optional(),
    minCents: Cents,
    maxCents: Cents,
    from: Day,
    to: Day,
    cursor: CursorSchema,
  })
  .refine(fromBeforeTo, range)
  .refine((q) => !q.minCents || !q.maxCents || BigInt(q.minCents) <= BigInt(q.maxCents), {
    message: 'The minimum must not be above the maximum',
    path: ['maxCents'],
  });
export type StaffPaymentSearch = z.infer<typeof StaffPaymentSearchSchema>;

export const StaffPaymentHitSchema = PaymentHistoryItemSchema.extend({
  applicantName: z.string(),
  reference: z.string().nullable(),
});
export type StaffPaymentHit = z.infer<typeof StaffPaymentHitSchema>;

export const StaffPaymentResultsSchema = z.object({
  items: z.array(StaffPaymentHitSchema),
  nextCursor: z.string().nullable(),
});
export type StaffPaymentResults = z.infer<typeof StaffPaymentResultsSchema>;

/** FR-112 export cap. */
export const EXPORT_ROW_CAP = 50_000;
