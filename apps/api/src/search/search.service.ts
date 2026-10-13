import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  type ApplicationPage,
  type ApplicationStatus,
  type MyApplicationsQuery,
  type MyPaymentsQuery,
  type PaymentChannel,
  type PaymentHistoryPage,
  type PaymentStatus,
  type StaffApplicationResults,
  type StaffApplicationSearch,
  type StaffPaymentResults,
  type StaffPaymentSearch,
} from '@govserve/shared';
import { AuditService } from '../audit/audit.service';
import { type AuthUser } from '../auth/auth.types';
import { assertSameDepartment } from '../common/guards/scope';
import { type RequestContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { CryptoService } from '../crypto/crypto.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decodeCursor, page, type Position } from './cursor';
import { csvRow } from './csv';
import { nameQuery } from './name-query';

const PAGE = 25;
const EXPORT_BATCH = 1000;

/** Day boundaries in Mogadishu time (UTC+3, no daylight saving). */
const dayStart = (day: string) => new Date(`${day}T00:00:00+03:00`);
const dayEnd = (day: string) => new Date(dayStart(day).getTime() + 86_400_000);

const and = (parts: Prisma.Sql[]) => Prisma.join(parts, ' AND ');

interface AppRow extends Position {
  referenceNo: string | null;
  serviceCode: string;
  serviceName: string;
  applicantName: string;
  subjectName: string | null;
  status: ApplicationStatus;
  assigneeName: string | null;
  updatedAt: Date;
  submittedAt: Date | null;
  decidedAt: Date | null;
}

interface PaymentRow extends Position {
  applicationId: string;
  referenceNo: string | null;
  serviceName: string;
  applicantName: string;
  channel: PaymentChannel;
  provider: string;
  reference: string;
  amountCents: bigint;
  status: PaymentStatus;
  receiptNo: string | null;
}

/**
 * History and search (FR-110–FR-112). Every query starts from the caller's scope — their own
 * applications, or their department — exactly like the detail endpoints. Values are always bound
 * parameters; encrypted fields are matched through blind indexes, never decrypted in SQL.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ─── Citizen ───────────────────────────────────────────────────────────────

  async myApplications(user: AuthUser, q: MyApplicationsQuery): Promise<ApplicationPage> {
    const where = [
      Prisma.sql`a."applicantId" = ${user.id}::uuid`,
      ...this.common(q),
      ...(q.q ? [Prisma.sql`a."referenceNo" ILIKE ${`%${q.q}%`}`] : []),
    ];
    const rows = await this.applications(where, decodeCursor(q.cursor), PAGE + 1);
    return page(rows, PAGE, (r) => ({
      id: r.id,
      referenceNo: r.referenceNo,
      serviceCode: r.serviceCode,
      serviceName: r.serviceName,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      submittedAt: r.submittedAt?.toISOString() ?? null,
    }));
  }

  async myPayments(user: AuthUser, q: MyPaymentsQuery): Promise<PaymentHistoryPage> {
    const where = [
      Prisma.sql`a."applicantId" = ${user.id}::uuid`,
      ...this.paymentCommon(q),
      ...(q.q
        ? [Prisma.sql`(a."referenceNo" ILIKE ${`%${q.q}%`} OR r."receiptNo" ILIKE ${`%${q.q}%`})`]
        : []),
    ];
    const rows = await this.payments(where, decodeCursor(q.cursor), PAGE + 1);
    return page(rows, PAGE, (r) => ({
      id: r.id,
      applicationId: r.applicationId,
      referenceNo: r.referenceNo,
      serviceName: r.serviceName,
      channel: r.channel,
      provider: r.provider,
      amountCents: r.amountCents.toString(),
      status: r.status,
      receiptNo: r.receiptNo,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ─── Staff ─────────────────────────────────────────────────────────────────

  async staffApplications(
    user: AuthUser,
    q: StaffApplicationSearch,
  ): Promise<StaffApplicationResults> {
    const where = this.staffApplicationWhere(user, q);
    if (!where) return { items: [], nextCursor: null };
    const rows = await this.applications(where, decodeCursor(q.cursor), PAGE + 1);
    return page(rows, PAGE, (r) => ({
      id: r.id,
      referenceNo: r.referenceNo,
      serviceName: r.serviceName,
      applicantName: r.applicantName,
      subjectName: r.subjectName,
      status: r.status,
      assigneeName: r.assigneeName,
      createdAt: r.createdAt.toISOString(),
      submittedAt: r.submittedAt?.toISOString() ?? null,
    }));
  }

  async staffPayments(user: AuthUser, q: StaffPaymentSearch): Promise<StaffPaymentResults> {
    const rows = await this.payments(
      this.staffPaymentWhere(user, q),
      decodeCursor(q.cursor),
      PAGE + 1,
    );
    return page(rows, PAGE, (r) => ({
      id: r.id,
      applicationId: r.applicationId,
      referenceNo: r.referenceNo,
      serviceName: r.serviceName,
      applicantName: r.applicantName,
      channel: r.channel,
      provider: r.provider,
      reference: r.reference,
      amountCents: r.amountCents.toString(),
      status: r.status,
      receiptNo: r.receiptNo,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ─── Export (FR-112) ───────────────────────────────────────────────────────

  /** Streams CSV in keyset batches up to the cap. The export is audited before the first row. */
  async exportApplications(
    user: AuthUser,
    q: StaffApplicationSearch,
    ctx: RequestContext,
    write: (chunk: string) => Promise<void>,
  ): Promise<number> {
    this.assertSupervisor(user);
    await this.auditExport(user, 'applications', q, ctx);
    await write(
      csvRow([
        'Reference',
        'Service',
        'Applicant',
        'Subject',
        'Status',
        'Assigned to',
        'Started',
        'Submitted',
        'Decided',
      ]),
    );
    const where = this.staffApplicationWhere(user, q);
    if (!where) return 0;
    return this.stream(
      (cursor, limit) => this.applications(where, cursor, limit),
      (r) =>
        csvRow([
          r.referenceNo,
          r.serviceName,
          r.applicantName,
          r.subjectName,
          r.status,
          r.assigneeName,
          r.createdAt.toISOString(),
          r.submittedAt?.toISOString(),
          r.decidedAt?.toISOString(),
        ]),
      write,
    );
  }

  async exportPayments(
    user: AuthUser,
    q: StaffPaymentSearch,
    ctx: RequestContext,
    write: (chunk: string) => Promise<void>,
  ): Promise<number> {
    this.assertSupervisor(user);
    await this.auditExport(user, 'payments', q, ctx);
    await write(
      csvRow([
        'Receipt',
        'Reference',
        'Service',
        'Applicant',
        'Method',
        'Provider',
        'Transaction ID',
        'Amount (cents)',
        'Status',
        'Recorded',
      ]),
    );
    const where = this.staffPaymentWhere(user, q);
    return this.stream(
      (cursor, limit) => this.payments(where, cursor, limit),
      (r) =>
        csvRow([
          r.receiptNo,
          r.referenceNo,
          r.serviceName,
          r.applicantName,
          r.channel,
          r.provider,
          r.reference,
          r.amountCents,
          r.status,
          r.createdAt.toISOString(),
        ]),
      write,
    );
  }

  private async stream<T extends Position>(
    fetch: (cursor: Position | null, limit: number) => Promise<T[]>,
    toCsv: (row: T) => string,
    write: (chunk: string) => Promise<void>,
  ): Promise<number> {
    const cap = this.config.SEARCH_EXPORT_CAP;
    let cursor: Position | null = null;
    let count = 0;
    while (count < cap) {
      const want = Math.min(EXPORT_BATCH, cap - count);
      const rows = await fetch(cursor, want);
      if (rows.length === 0) return count;
      await write(rows.map(toCsv).join(''));
      count += rows.length;
      cursor = rows[rows.length - 1]!;
      if (rows.length < want) return count;
    }
    // More rows exist than the cap allows: say so in the file itself.
    if ((await fetch(cursor, 1)).length > 0) {
      await write(csvRow([`Export stopped at ${cap} rows. Narrow the search to export the rest.`]));
    }
    return count;
  }

  private assertSupervisor(user: AuthUser): void {
    assertSameDepartment(user, user.departmentId);
    if (user.role !== 'SUPERVISOR') {
      throw new ForbiddenException({
        code: 'SUPERVISOR_ONLY',
        message: 'Only a supervisor can export search results.',
      });
    }
  }

  /** Filter names and non-identifying values only: names, IDs and phones are recorded as "provided". */
  private async auditExport(
    user: AuthUser,
    kind: string,
    q: object,
    ctx: RequestContext,
  ): Promise<void> {
    const IDENTIFYING = new Set(['name', 'nationalId', 'phone']);
    const filters = Object.fromEntries(
      Object.entries(q)
        .filter(([k, v]) => v !== undefined && k !== 'cursor')
        .map(([k, v]) => [k, IDENTIFYING.has(k) ? 'provided' : String(v)]),
    );
    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, {
        actor: { id: user.id, role: user.role, type: 'USER' },
        action: 'SEARCH_EXPORTED',
        entityType: 'Search',
        entityId: kind,
        departmentId: user.departmentId,
        after: { kind, filters, cap: this.config.SEARCH_EXPORT_CAP },
        ctx,
      }),
    );
  }

  // ─── WHERE builders ────────────────────────────────────────────────────────

  private common(q: {
    status?: string | undefined;
    service?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
  }): Prisma.Sql[] {
    return [
      ...(q.status ? [Prisma.sql`a."status" = ${q.status}::"ApplicationStatus"`] : []),
      ...(q.service ? [Prisma.sql`s."code" = ${q.service}`] : []),
      ...(q.from ? [Prisma.sql`a."createdAt" >= ${dayStart(q.from)}`] : []),
      ...(q.to ? [Prisma.sql`a."createdAt" < ${dayEnd(q.to)}`] : []),
    ];
  }

  private paymentCommon(q: {
    status?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
  }): Prisma.Sql[] {
    return [
      ...(q.status ? [Prisma.sql`p."status" = ${q.status}::"PaymentStatus"`] : []),
      ...(q.from ? [Prisma.sql`p."createdAt" >= ${dayStart(q.from)}`] : []),
      ...(q.to ? [Prisma.sql`p."createdAt" < ${dayEnd(q.to)}`] : []),
    ];
  }

  /** Null when the criteria can match nothing (e.g. a name with no letters). */
  private staffApplicationWhere(user: AuthUser, q: StaffApplicationSearch): Prisma.Sql[] | null {
    assertSameDepartment(user, user.departmentId);
    const where = [
      Prisma.sql`a."departmentId" = ${user.departmentId}::uuid`,
      // Drafts are private to the citizen until submitted.
      Prisma.sql`a."status" <> 'DRAFT'`,
      ...this.common(q),
    ];
    if (q.referenceNo) where.push(Prisma.sql`a."referenceNo" ILIKE ${`%${q.referenceNo}%`}`);
    if (q.receiptNo)
      where.push(
        Prisma.sql`a."id" IN (SELECT r."applicationId" FROM "receipt" r WHERE r."receiptNo" = ${q.receiptNo})`,
      );
    if (q.certificateNo)
      where.push(
        Prisma.sql`a."id" IN (SELECT c."applicationId" FROM "certificate" c WHERE c."certificateNo" = ${q.certificateNo})`,
      );
    if (q.name) {
      const tsq = nameQuery(q.name);
      if (!tsq) return null;
      // One IN over a UNION: the few matching ids drive the lookup (an OR of two subqueries would
      // walk the whole department index and filter).
      where.push(Prisma.sql`a."id" IN (
        SELECT d2."applicationId" FROM "application_data" d2
          WHERE to_tsvector('simple', coalesce(d2."subjectFullName", '')) @@ to_tsquery('simple', ${tsq})
        UNION
        SELECT a2."id" FROM "application" a2 JOIN "user" u2 ON u2."id" = a2."applicantId"
          WHERE to_tsvector('simple', coalesce(u2."fullName", '')) @@ to_tsquery('simple', ${tsq}))`);
    }
    if (q.nationalId) {
      const bidx = this.crypto.blindIndex('nationalId', q.nationalId);
      where.push(Prisma.sql`a."id" IN (
        SELECT d3."applicationId" FROM "application_data" d3 WHERE d3."subjectNationalIdBidx" = ${bidx}
        UNION
        SELECT a3."id" FROM "application" a3 JOIN "citizen_profile" cp ON cp."userId" = a3."applicantId"
          WHERE cp."nationalIdBidx" = ${bidx})`);
    }
    if (q.phone) {
      const bidx = this.crypto.blindIndex('phone', q.phone);
      where.push(
        Prisma.sql`a."applicantId" IN (SELECT u3."id" FROM "user" u3 WHERE u3."phoneBidx" = ${bidx})`,
      );
    }
    return where;
  }

  private staffPaymentWhere(user: AuthUser, q: StaffPaymentSearch): Prisma.Sql[] {
    assertSameDepartment(user, user.departmentId);
    return [
      Prisma.sql`a."departmentId" = ${user.departmentId}::uuid`,
      ...this.paymentCommon(q),
      ...(q.channel ? [Prisma.sql`p."channel" = ${q.channel}::"PaymentChannel"`] : []),
      ...(q.minCents ? [Prisma.sql`p."amountCents" >= ${BigInt(q.minCents)}`] : []),
      ...(q.maxCents ? [Prisma.sql`p."amountCents" <= ${BigInt(q.maxCents)}`] : []),
      ...(q.referenceNo ? [Prisma.sql`a."referenceNo" ILIKE ${`%${q.referenceNo}%`}`] : []),
      ...(q.receiptNo ? [Prisma.sql`r."receiptNo" = ${q.receiptNo}`] : []),
    ];
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  private applications(
    where: Prisma.Sql[],
    after: Position | null,
    limit: number,
  ): Promise<AppRow[]> {
    const keyset = after
      ? [Prisma.sql`(a."createdAt", a."id") < (${after.createdAt}, ${after.id}::uuid)`]
      : [];
    return this.prisma.$queryRaw<AppRow[]>`
      SELECT a."id", a."referenceNo", s."code" AS "serviceCode", s."name" AS "serviceName",
             u."fullName" AS "applicantName", d."subjectFullName" AS "subjectName", a."status",
             asg."fullName" AS "assigneeName", a."createdAt", a."updatedAt", a."submittedAt", a."decidedAt"
      FROM "application" a
      JOIN "service" s ON s."id" = a."serviceId"
      JOIN "user" u ON u."id" = a."applicantId"
      LEFT JOIN "application_data" d ON d."applicationId" = a."id"
      LEFT JOIN "user" asg ON asg."id" = a."assigneeId"
      WHERE ${and([...where, ...keyset])}
      ORDER BY a."createdAt" DESC, a."id" DESC
      LIMIT ${limit}`;
  }

  private payments(
    where: Prisma.Sql[],
    after: Position | null,
    limit: number,
  ): Promise<PaymentRow[]> {
    const keyset = after
      ? [Prisma.sql`(p."createdAt", p."id") < (${after.createdAt}, ${after.id}::uuid)`]
      : [];
    return this.prisma.$queryRaw<PaymentRow[]>`
      SELECT p."id", p."applicationId", a."referenceNo", s."name" AS "serviceName",
             u."fullName" AS "applicantName", p."channel", p."provider", p."reference",
             p."amountCents", p."status", r."receiptNo", p."createdAt"
      FROM "payment" p
      JOIN "application" a ON a."id" = p."applicationId"
      JOIN "service" s ON s."id" = a."serviceId"
      JOIN "user" u ON u."id" = a."applicantId"
      LEFT JOIN "receipt" r ON r."paymentId" = p."id"
      WHERE ${and([...where, ...keyset])}
      ORDER BY p."createdAt" DESC, p."id" DESC
      LIMIT ${limit}`;
  }
}
