import { z } from 'zod';
import { ApplicationStatus } from './enums.js';
import { PaymentChannels } from './payments.js';
import { CursorSchema } from './search.js';

const appStatuses = Object.values(ApplicationStatus) as [ApplicationStatus, ...ApplicationStatus[]];
const Cents = z.string().regex(/^-?\d+$/);

export const MovementKinds = ['CONFIRMED', 'REFUNDED', 'REVERSED'] as const;
export type MovementKind = (typeof MovementKinds)[number];
export const ReportDatasets = [
  'collections',
  'volumes',
  'pending-work',
  'movements',
  'applications',
] as const;
export type ReportDataset = (typeof ReportDatasets)[number];

const filterShape = {
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  departmentId: z.uuid().optional(),
  service: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{2,39}$/)
    .optional(),
  channel: z.enum(PaymentChannels).optional(),
};
const dateOrder: [
  (q: { from?: string | undefined; to?: string | undefined }) => boolean,
  { message: string; path: string[] },
] = [
  (q) => !q.from || !q.to || q.from <= q.to,
  { message: 'The start date must be on or before the end date', path: ['to'] },
];

/** Dashboard filters (FR-120). Supervisors are always limited to their own department. */
export const ReportFiltersSchema = z.strictObject(filterShape).refine(...dateOrder);
export type ReportFilters = z.infer<typeof ReportFiltersSchema>;

/** The scope actually applied (after role scoping and defaults). */
export const ReportScopeSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  departmentId: z.uuid().nullable(),
  service: z.string().nullable(),
  channel: z.enum(PaymentChannels).nullable(),
});
export type ReportScope = z.infer<typeof ReportScopeSchema>;

const MoneyTotals = {
  confirmedCents: Cents,
  refundedCents: Cents,
  reversedCents: Cents,
  netCents: Cents,
};

export const ReportSummarySchema = z.object({
  scope: ReportScopeSchema,
  collections: z.object(MoneyTotals),
  outstandingCents: Cents,
  byStatus: z.array(z.object({ status: z.enum(appStatuses), count: z.number().int() })),
  processing: z.object({
    decided: z.number().int(),
    medianHours: z.number().nullable(),
    p90Hours: z.number().nullable(),
  }),
  sla: z.object({
    measured: z.number().int(),
    onTime: z.number().int(),
    compliancePct: z.number().nullable(),
    overdue: z.number().int(),
  }),
});
export type ReportSummary = z.infer<typeof ReportSummarySchema>;

export const CollectionsGroupBys = ['day', 'service', 'channel'] as const;
export const CollectionsQuerySchema = z
  .strictObject({ ...filterShape, groupBy: z.enum(CollectionsGroupBys).default('day') })
  .refine(...dateOrder);
export type CollectionsQuery = z.infer<typeof CollectionsQuerySchema>;

export const CollectionsReportSchema = z.object({
  scope: ReportScopeSchema,
  groupBy: z.enum(CollectionsGroupBys),
  rows: z.array(z.object({ key: z.string(), label: z.string(), ...MoneyTotals })),
  totals: z.object(MoneyTotals),
});
export type CollectionsReport = z.infer<typeof CollectionsReportSchema>;

export const VolumesReportSchema = z.object({
  scope: ReportScopeSchema,
  weeks: z.array(
    z.object({ weekStart: z.iso.date(), submitted: z.number().int(), completed: z.number().int() }),
  ),
});
export type VolumesReport = z.infer<typeof VolumesReportSchema>;

export const PendingWorkReportSchema = z.object({
  scope: ReportScopeSchema,
  departments: z.array(
    z.object({
      departmentId: z.uuid(),
      departmentName: z.string(),
      queued: z.number().int(),
      oldestQueuedAt: z.iso.datetime().nullable(),
      overdue: z.number().int(),
    }),
  ),
  officers: z.array(
    z.object({
      officerId: z.uuid(),
      officerName: z.string(),
      departmentName: z.string(),
      assigned: z.number().int(),
      oldestSince: z.iso.datetime().nullable(),
    }),
  ),
});
export type PendingWorkReport = z.infer<typeof PendingWorkReportSchema>;

// ─── Drill-down lists (FR-121) ───────────────────────────────────────────────

export const MovementsQuerySchema = z
  .strictObject({ ...filterShape, kind: z.enum(MovementKinds).optional(), cursor: CursorSchema })
  .refine(...dateOrder);
export type MovementsQuery = z.infer<typeof MovementsQuerySchema>;

export const MovementsPageSchema = z.object({
  scope: ReportScopeSchema,
  items: z.array(
    z.object({
      eventId: z.uuid(),
      occurredAt: z.iso.datetime(),
      kind: z.enum(MovementKinds),
      applicationId: z.uuid(),
      referenceNo: z.string().nullable(),
      serviceName: z.string(),
      channel: z.enum(PaymentChannels),
      amountCents: Cents,
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type MovementsPage = z.infer<typeof MovementsPageSchema>;

export const ReportApplicationsQuerySchema = z
  .strictObject({
    ...filterShape,
    status: z.enum(appStatuses).optional(),
    /** overdue: open past SLA; outstanding: awaiting payment with a balance; decided/submitted: in the range. */
    view: z.enum(['overdue', 'outstanding', 'decided', 'submitted']).optional(),
    cursor: CursorSchema,
  })
  .refine(...dateOrder);
export type ReportApplicationsQuery = z.infer<typeof ReportApplicationsQuerySchema>;

export const ReportApplicationsPageSchema = z.object({
  scope: ReportScopeSchema,
  items: z.array(
    z.object({
      id: z.uuid(),
      referenceNo: z.string().nullable(),
      serviceName: z.string(),
      status: z.enum(appStatuses),
      submittedAt: z.iso.datetime().nullable(),
      decidedAt: z.iso.datetime().nullable(),
      slaDueAt: z.iso.datetime().nullable(),
      outstandingCents: Cents,
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type ReportApplicationsPage = z.infer<typeof ReportApplicationsPageSchema>;
