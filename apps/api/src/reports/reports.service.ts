import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  type ApplicationStatus,
  type CollectionsQuery,
  type CollectionsReport,
  type MovementKind,
  type MovementsPage,
  type MovementsQuery,
  type PaymentChannel,
  type PendingWorkReport,
  type ReportApplicationsPage,
  type ReportApplicationsQuery,
  type ReportDataset,
  type ReportFilters,
  type ReportScope,
  type ReportSummary,
  type VolumesReport,
} from '@govserve/shared';
import { AuditService } from '../audit/audit.service';
import { type AuthUser } from '../auth/auth.types';
import { type RequestContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decodeCursor, page, type Position } from '../search/cursor';
import { csvRow } from '../search/csv';

const DECIDED = Prisma.sql`('ISSUED', 'REJECTED', 'REFERRED')`;
const OPEN_ON_CLOCK = Prisma.sql`('QUEUED', 'IN_REVIEW', 'AWAITING_SUPERVISOR')`;
const HELD = Prisma.sql`('IN_REVIEW', 'AWAITING_SUPERVISOR', 'CORRECTION_REQUESTED', 'AWAITING_APPOINTMENT')`;
const TZ = 'Africa/Mogadishu';
const PAGE = 25;
const EXPORT_BATCH = 1000;
const DEFAULT_DAYS = 30;

const and = (parts: Prisma.Sql[]) =>
  parts.length ? Prisma.join(parts, ' AND ') : Prisma.sql`TRUE`;

/** Mogadishu is UTC+3 all year. */
export function mogadishuToday(now = new Date()): string {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}
export const dayStart = (day: string) => new Date(`${day}T00:00:00+03:00`);
export const dayEnd = (day: string) => new Date(dayStart(day).getTime() + 86_400_000);
export function addDays(day: string, n: number): string {
  return new Date(dayStart(day).getTime() + n * 86_400_000 + 3 * 3_600_000)
    .toISOString()
    .slice(0, 10);
}

interface Scope extends ReportScope {
  start: Date;
  end: Date;
}

interface MoneyRow {
  confirmed: string;
  refunded: string;
  reversed: string;
  net: string;
}

/**
 * Management dashboard (FR-120/FR-121). Everything is aggregated in SQL over the
 * `report_money_movement` and `report_application` views, live, so every figure reconciles with
 * the transaction tables to the cent. Supervisors are always held to their own department.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  scope(user: AuthUser, q: ReportFilters, now = new Date()): Scope {
    let departmentId: string | null;
    if (user.role === 'SUPERVISOR') {
      if (!user.departmentId) throw new ForbiddenException();
      departmentId = user.departmentId; // any requested department is ignored
    } else if (user.role === 'ADMIN') {
      departmentId = q.departmentId ?? null;
    } else {
      throw new ForbiddenException();
    }
    const to = q.to ?? mogadishuToday(now);
    const from = q.from ?? addDays(to, -(DEFAULT_DAYS - 1));
    return {
      from,
      to,
      departmentId,
      service: q.service ?? null,
      channel: q.channel ?? null,
      start: dayStart(from),
      end: dayEnd(to),
    };
  }

  // ─── Summary ───────────────────────────────────────────────────────────────

  async summary(user: AuthUser, q: ReportFilters): Promise<ReportSummary> {
    const s = this.scope(user, q);
    const appScope = this.appWhere(s);
    const [money, outstanding, byStatus, processing, sla, overdue] = await Promise.all([
      this.moneyTotals(s),
      this.prisma.$queryRaw<[{ cents: string }]>`
        SELECT COALESCE(SUM(r."outstandingCents"), 0)::text AS "cents" FROM "report_application" r
        WHERE ${and([...appScope, Prisma.sql`r."status" = 'AWAITING_PAYMENT'`])}`,
      this.prisma.$queryRaw<{ status: ApplicationStatus; count: number }[]>`
        SELECT r."status", COUNT(*)::int AS "count" FROM "report_application" r
        WHERE ${and([...appScope, Prisma.sql`r."submittedAt" >= ${s.start}`, Prisma.sql`r."submittedAt" < ${s.end}`])}
        GROUP BY r."status" ORDER BY r."status"`,
      this.prisma.$queryRaw<[{ decided: number; median: number | null; p90: number | null }]>`
        SELECT COUNT(*)::int AS "decided",
               round((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM r."decidedAt" - r."submittedAt") / 3600))::numeric, 1)::float8 AS "median",
               round((percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM r."decidedAt" - r."submittedAt") / 3600))::numeric, 1)::float8 AS "p90"
        FROM "report_application" r
        WHERE ${and([...this.decidedWhere(s), Prisma.sql`r."submittedAt" IS NOT NULL`])}`,
      this.prisma.$queryRaw<[{ measured: number; onTime: number }]>`
        SELECT COUNT(*)::int AS "measured", COUNT(*) FILTER (WHERE r."decidedAt" <= r."slaDueAt")::int AS "onTime"
        FROM "report_application" r
        WHERE ${and([...this.decidedWhere(s), Prisma.sql`r."slaDueAt" IS NOT NULL`])}`,
      this.prisma.$queryRaw<[{ count: number }]>`
        SELECT COUNT(*)::int AS "count" FROM "report_application" r WHERE ${and([...appScope, ...this.overdueWhere()])}`,
    ]);
    return {
      scope: this.publicScope(s),
      collections: toMoney(money),
      outstandingCents: outstanding[0].cents,
      byStatus,
      processing: {
        decided: processing[0].decided,
        medianHours: processing[0].median,
        p90Hours: processing[0].p90,
      },
      sla: {
        measured: sla[0].measured,
        onTime: sla[0].onTime,
        compliancePct: sla[0].measured
          ? Math.round((sla[0].onTime / sla[0].measured) * 1000) / 10
          : null,
        overdue: overdue[0].count,
      },
    };
  }

  // ─── Collections ───────────────────────────────────────────────────────────

  async collections(user: AuthUser, q: CollectionsQuery): Promise<CollectionsReport> {
    const s = this.scope(user, q);
    const where = and(this.moneyWhere(s));
    const sums = Prisma.sql`
      COALESCE(SUM(m."amountCents") FILTER (WHERE m."kind" = 'CONFIRMED'), 0)::text AS "confirmed",
      COALESCE(SUM(m."amountCents") FILTER (WHERE m."kind" = 'REFUNDED'), 0)::text AS "refunded",
      COALESCE(SUM(m."amountCents") FILTER (WHERE m."kind" = 'REVERSED'), 0)::text AS "reversed",
      COALESCE(SUM(CASE WHEN m."kind" = 'CONFIRMED' THEN m."amountCents" ELSE -m."amountCents" END), 0)::text AS "net"`;
    let rows: (MoneyRow & { key: string; label: string })[];
    if (q.groupBy === 'day') {
      // Every day in the range, zeros included, so charts have no gaps.
      rows = await this.prisma.$queryRaw`
        SELECT d.day::date::text AS "key", d.day::date::text AS "label", x."confirmed", x."refunded", x."reversed", x."net"
        FROM generate_series(${s.from}::timestamp, ${s.to}::timestamp, interval '1 day') AS d(day)
        LEFT JOIN LATERAL (
          SELECT ${sums} FROM "report_money_movement" m
          WHERE ${where} AND (m."occurredAt" AT TIME ZONE ${TZ})::date = d.day::date
        ) x ON true
        ORDER BY d.day`;
    } else if (q.groupBy === 'service') {
      rows = await this.prisma.$queryRaw`
        SELECT m."serviceCode" AS "key", MIN(m."serviceName") AS "label", ${sums}
        FROM "report_money_movement" m WHERE ${where}
        GROUP BY m."serviceCode" ORDER BY m."serviceCode"`;
    } else {
      rows = await this.prisma.$queryRaw`
        SELECT m."channel"::text AS "key", m."channel"::text AS "label", ${sums}
        FROM "report_money_movement" m WHERE ${where}
        GROUP BY m."channel" ORDER BY m."channel"`;
    }
    return {
      scope: this.publicScope(s),
      groupBy: q.groupBy,
      rows: rows.map((r) => ({ key: r.key, label: r.label, ...toMoney(r) })),
      totals: toMoney(await this.moneyTotals(s)),
    };
  }

  // ─── Volumes ───────────────────────────────────────────────────────────────

  async volumes(user: AuthUser, q: ReportFilters): Promise<VolumesReport> {
    const s = this.scope(user, q);
    const scope = and(this.appWhere(s));
    const weeks = await this.prisma.$queryRaw<
      { weekStart: string; submitted: number; completed: number }[]
    >`
      SELECT w.week::date::text AS "weekStart",
        (SELECT COUNT(*)::int FROM "report_application" r WHERE ${scope}
           AND date_trunc('week', r."submittedAt" AT TIME ZONE ${TZ}) = w.week
           AND r."submittedAt" >= ${s.start} AND r."submittedAt" < ${s.end}) AS "submitted",
        (SELECT COUNT(*)::int FROM "report_application" r WHERE ${scope}
           AND r."status" IN ${DECIDED}
           AND date_trunc('week', r."decidedAt" AT TIME ZONE ${TZ}) = w.week
           AND r."decidedAt" >= ${s.start} AND r."decidedAt" < ${s.end}) AS "completed"
      FROM generate_series(date_trunc('week', ${s.from}::timestamp), date_trunc('week', ${s.to}::timestamp), interval '1 week') AS w(week)
      ORDER BY w.week`;
    return { scope: this.publicScope(s), weeks };
  }

  // ─── Pending work (a snapshot of now) ──────────────────────────────────────

  async pendingWork(user: AuthUser, q: ReportFilters): Promise<PendingWorkReport> {
    const s = this.scope(user, q);
    const dept = s.departmentId ? Prisma.sql`d."id" = ${s.departmentId}::uuid` : Prisma.sql`TRUE`;
    const svc = s.service ? Prisma.sql`r."serviceCode" = ${s.service}` : Prisma.sql`TRUE`;
    const departments = await this.prisma.$queryRaw<PendingWorkReport['departments']>`
      SELECT d."id" AS "departmentId", d."name" AS "departmentName",
        COUNT(r."id") FILTER (WHERE r."status" = 'QUEUED')::int AS "queued",
        to_char(MIN(r."queuedAt") FILTER (WHERE r."status" = 'QUEUED') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "oldestQueuedAt",
        COUNT(r."id") FILTER (WHERE r."status" IN ${OPEN_ON_CLOCK} AND r."slaPausedAt" IS NULL AND r."slaDueAt" < now())::int AS "overdue"
      FROM "department" d
      LEFT JOIN "report_application" r ON r."departmentId" = d."id" AND ${svc}
      WHERE ${dept}
      GROUP BY d."id", d."name" ORDER BY d."name"`;
    const officers = await this.prisma.$queryRaw<PendingWorkReport['officers']>`
      SELECT u."id" AS "officerId", u."fullName" AS "officerName", d."name" AS "departmentName",
        COUNT(r."id")::int AS "assigned",
        to_char(MIN(r."queuedAt") AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "oldestSince"
      FROM "user" u
      JOIN "department" d ON d."id" = u."departmentId"
      LEFT JOIN "report_application" r ON r."assigneeId" = u."id" AND r."status" IN ${HELD} AND ${svc}
      WHERE u."role" IN ('OFFICER', 'SUPERVISOR') AND u."status" = 'ACTIVE' AND ${dept}
      GROUP BY u."id", u."fullName", d."name"
      ORDER BY "assigned" DESC, u."fullName"`;
    return { scope: this.publicScope(s), departments, officers };
  }

  // ─── Drill-down (FR-121) ───────────────────────────────────────────────────

  async movements(user: AuthUser, q: MovementsQuery): Promise<MovementsPage> {
    const s = this.scope(user, q);
    const rows = await this.movementRows(s, q.kind, decodeCursor(q.cursor), PAGE + 1);
    return { scope: this.publicScope(s), ...page(rows, PAGE, toMovement) };
  }

  async applications(user: AuthUser, q: ReportApplicationsQuery): Promise<ReportApplicationsPage> {
    const s = this.scope(user, q);
    const rows = await this.applicationRows(s, q, decodeCursor(q.cursor), PAGE + 1);
    return { scope: this.publicScope(s), ...page(rows, PAGE, toApplication) };
  }

  // ─── CSV export (audited) ──────────────────────────────────────────────────

  async export(
    user: AuthUser,
    dataset: ReportDataset,
    q: ReportFilters &
      Partial<Pick<MovementsQuery, 'kind'> & Pick<ReportApplicationsQuery, 'status' | 'view'>>,
    ctx: RequestContext,
    write: (chunk: string) => Promise<void>,
  ): Promise<void> {
    const s = this.scope(user, q);
    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, {
        actor: { id: user.id, role: user.role, type: 'USER' },
        action: 'REPORT_EXPORTED',
        entityType: 'Report',
        entityId: dataset,
        departmentId: s.departmentId,
        after: {
          dataset,
          filters: {
            ...this.publicScope(s),
            ...(q.kind && { kind: q.kind }),
            ...(q.status && { status: q.status }),
            ...(q.view && { view: q.view }),
          },
        },
        ctx,
      }),
    );
    switch (dataset) {
      case 'collections': {
        for (const groupBy of ['day', 'service', 'channel'] as const) {
          const r = await this.collections(user, { ...q, groupBy });
          if (groupBy === 'day')
            await write(
              csvRow([
                'Group',
                'Key',
                'Confirmed (cents)',
                'Refunded (cents)',
                'Reversed (cents)',
                'Net (cents)',
              ]),
            );
          await write(
            r.rows
              .map((x) =>
                csvRow([
                  groupBy,
                  x.label,
                  x.confirmedCents,
                  x.refundedCents,
                  x.reversedCents,
                  x.netCents,
                ]),
              )
              .join(''),
          );
          if (groupBy === 'channel')
            await write(
              csvRow([
                'total',
                '',
                r.totals.confirmedCents,
                r.totals.refundedCents,
                r.totals.reversedCents,
                r.totals.netCents,
              ]),
            );
        }
        return;
      }
      case 'volumes': {
        const r = await this.volumes(user, q);
        await write(csvRow(['Week starting', 'Submitted', 'Completed']));
        await write(r.weeks.map((w) => csvRow([w.weekStart, w.submitted, w.completed])).join(''));
        return;
      }
      case 'pending-work': {
        const r = await this.pendingWork(user, q);
        await write(
          csvRow(['Department', 'Officer', 'Queued', 'Assigned', 'Overdue', 'Oldest since']),
        );
        await write(
          r.departments
            .map((d) => csvRow([d.departmentName, '', d.queued, '', d.overdue, d.oldestQueuedAt]))
            .join(''),
        );
        await write(
          r.officers
            .map((o) =>
              csvRow([o.departmentName, o.officerName, '', o.assigned, '', o.oldestSince]),
            )
            .join(''),
        );
        return;
      }
      case 'movements':
        await write(csvRow(['Date', 'Kind', 'Reference', 'Service', 'Method', 'Amount (cents)']));
        await this.stream(
          (c, n) => this.movementRows(s, q.kind, c, n),
          (r) =>
            csvRow([
              r.createdAt.toISOString(),
              r.kind,
              r.referenceNo,
              r.serviceName,
              r.channel,
              r.amountCents,
            ]),
          write,
        );
        return;
      case 'applications':
        await write(
          csvRow([
            'Reference',
            'Service',
            'Status',
            'Submitted',
            'Decided',
            'SLA due',
            'Outstanding (cents)',
          ]),
        );
        await this.stream(
          (c, n) => this.applicationRows(s, q, c, n),
          (r) =>
            csvRow([
              r.referenceNo,
              r.serviceName,
              r.status,
              r.submittedAt?.toISOString(),
              r.decidedAt?.toISOString(),
              r.slaDueAt?.toISOString(),
              r.outstandingCents,
            ]),
          write,
        );
        return;
    }
  }

  private async stream<T extends Position>(
    fetch: (cursor: Position | null, limit: number) => Promise<T[]>,
    toCsv: (row: T) => string,
    write: (chunk: string) => Promise<void>,
  ): Promise<void> {
    const cap = this.config.SEARCH_EXPORT_CAP;
    let cursor: Position | null = null;
    let count = 0;
    while (count < cap) {
      const want = Math.min(EXPORT_BATCH, cap - count);
      const rows = await fetch(cursor, want);
      if (rows.length === 0) return;
      await write(rows.map(toCsv).join(''));
      count += rows.length;
      cursor = rows[rows.length - 1]!;
      if (rows.length < want) return;
    }
    if ((await fetch(cursor, 1)).length > 0) {
      await write(
        csvRow([`Export stopped at ${cap} rows. Narrow the filters to export the rest.`]),
      );
    }
  }

  // ─── SQL pieces ────────────────────────────────────────────────────────────

  private publicScope(s: Scope): ReportScope {
    return {
      from: s.from,
      to: s.to,
      departmentId: s.departmentId,
      service: s.service,
      channel: s.channel,
    };
  }

  private moneyWhere(s: Scope): Prisma.Sql[] {
    return [
      Prisma.sql`m."occurredAt" >= ${s.start}`,
      Prisma.sql`m."occurredAt" < ${s.end}`,
      ...(s.departmentId ? [Prisma.sql`m."departmentId" = ${s.departmentId}::uuid`] : []),
      ...(s.service ? [Prisma.sql`m."serviceCode" = ${s.service}`] : []),
      ...(s.channel ? [Prisma.sql`m."channel" = ${s.channel}::"PaymentChannel"`] : []),
    ];
  }

  private appWhere(s: Scope): Prisma.Sql[] {
    return [
      ...(s.departmentId ? [Prisma.sql`r."departmentId" = ${s.departmentId}::uuid`] : []),
      ...(s.service ? [Prisma.sql`r."serviceCode" = ${s.service}`] : []),
    ];
  }

  private decidedWhere(s: Scope): Prisma.Sql[] {
    return [
      ...this.appWhere(s),
      Prisma.sql`r."status" IN ${DECIDED}`,
      Prisma.sql`r."decidedAt" >= ${s.start}`,
      Prisma.sql`r."decidedAt" < ${s.end}`,
    ];
  }

  private overdueWhere(): Prisma.Sql[] {
    return [
      Prisma.sql`r."status" IN ${OPEN_ON_CLOCK}`,
      Prisma.sql`r."slaPausedAt" IS NULL`,
      Prisma.sql`r."slaDueAt" < now()`,
    ];
  }

  private async moneyTotals(s: Scope): Promise<MoneyRow> {
    const [row] = await this.prisma.$queryRaw<[MoneyRow]>`
      SELECT
        COALESCE(SUM(m."amountCents") FILTER (WHERE m."kind" = 'CONFIRMED'), 0)::text AS "confirmed",
        COALESCE(SUM(m."amountCents") FILTER (WHERE m."kind" = 'REFUNDED'), 0)::text AS "refunded",
        COALESCE(SUM(m."amountCents") FILTER (WHERE m."kind" = 'REVERSED'), 0)::text AS "reversed",
        COALESCE(SUM(CASE WHEN m."kind" = 'CONFIRMED' THEN m."amountCents" ELSE -m."amountCents" END), 0)::text AS "net"
      FROM "report_money_movement" m WHERE ${and(this.moneyWhere(s))}`;
    return row;
  }

  private movementRows(
    s: Scope,
    kind: MovementKind | undefined,
    after: Position | null,
    limit: number,
  ) {
    const where = [
      ...this.moneyWhere(s),
      ...(kind ? [Prisma.sql`m."kind" = ${kind}`] : []),
      ...(after
        ? [Prisma.sql`(m."occurredAt", m."eventId") < (${after.createdAt}, ${after.id}::uuid)`]
        : []),
    ];
    return this.prisma.$queryRaw<MovementRow[]>`
      SELECT m."eventId" AS "id", m."occurredAt" AS "createdAt", m."kind", m."applicationId", m."referenceNo",
             m."serviceName", m."channel", m."amountCents"
      FROM "report_money_movement" m WHERE ${and(where)}
      ORDER BY m."occurredAt" DESC, m."eventId" DESC LIMIT ${limit}`;
  }

  private applicationRows(
    s: Scope,
    q: Partial<Pick<ReportApplicationsQuery, 'status' | 'view'>>,
    after: Position | null,
    limit: number,
  ) {
    const view =
      q.view === 'overdue'
        ? this.overdueWhere()
        : q.view === 'outstanding'
          ? [Prisma.sql`r."status" = 'AWAITING_PAYMENT'`, Prisma.sql`r."outstandingCents" > 0`]
          : q.view === 'decided'
            ? this.decidedWhere(s)
            : [Prisma.sql`r."submittedAt" >= ${s.start}`, Prisma.sql`r."submittedAt" < ${s.end}`];
    const where = [
      ...this.appWhere(s),
      ...view,
      ...(q.status ? [Prisma.sql`r."status" = ${q.status}::"ApplicationStatus"`] : []),
      ...(after
        ? [Prisma.sql`(r."createdAt", r."id") < (${after.createdAt}, ${after.id}::uuid)`]
        : []),
    ];
    return this.prisma.$queryRaw<AppRow[]>`
      SELECT r."id", r."createdAt", r."referenceNo", r."serviceName", r."status", r."submittedAt", r."decidedAt",
             r."slaDueAt", r."outstandingCents"
      FROM "report_application" r WHERE ${and(where)}
      ORDER BY r."createdAt" DESC, r."id" DESC LIMIT ${limit}`;
  }
}

interface MovementRow extends Position {
  kind: MovementKind;
  applicationId: string;
  referenceNo: string | null;
  serviceName: string;
  channel: PaymentChannel;
  amountCents: bigint;
}

interface AppRow extends Position {
  referenceNo: string | null;
  serviceName: string;
  status: ApplicationStatus;
  submittedAt: Date | null;
  decidedAt: Date | null;
  slaDueAt: Date | null;
  outstandingCents: bigint;
}

function toMoney(r: MoneyRow) {
  return {
    confirmedCents: r.confirmed ?? '0',
    refundedCents: r.refunded ?? '0',
    reversedCents: r.reversed ?? '0',
    netCents: r.net ?? '0',
  };
}

function toMovement(r: MovementRow) {
  return {
    eventId: r.id,
    occurredAt: r.createdAt.toISOString(),
    kind: r.kind,
    applicationId: r.applicationId,
    referenceNo: r.referenceNo,
    serviceName: r.serviceName,
    channel: r.channel,
    amountCents: r.amountCents.toString(),
  };
}

function toApplication(r: AppRow) {
  return {
    id: r.id,
    referenceNo: r.referenceNo,
    serviceName: r.serviceName,
    status: r.status,
    submittedAt: r.submittedAt?.toISOString() ?? null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    slaDueAt: r.slaDueAt?.toISOString() ?? null,
    outstandingCents: r.outstandingCents.toString(),
  };
}
