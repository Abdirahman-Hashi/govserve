import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { type AuditEntry, type AuditPage, type AuditQuery } from '@govserve/shared';
import { type AuthUser } from '../auth/auth.types';
import { type RequestContext } from '../common/request-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { csvRow } from '../search/csv';
import { AuditService } from './audit.service';

const PAGE = 50;
const EXPORT_CAP = 50_000;
const EXPORT_BATCH = 1000;
const dayStart = (day: string) => new Date(`${day}T00:00:00+03:00`);

interface Row {
  chainSeq: bigint;
  occurredAt: Date;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  actorType: 'USER' | 'SYSTEM' | 'PUBLIC';
  action: string;
  entityType: string;
  entityId: string;
  departmentId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  hash: Uint8Array;
}

/**
 * Read-only audit viewer (FR-132). Supervisors see only rows of their department (auth and admin
 * rows have none, so they are admin-only); admins see everything. Viewing exports is itself audited.
 */
@Injectable()
export class AuditQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, q: AuditQuery): Promise<AuditPage> {
    const rows = await this.rows(this.where(user, q), q.cursor ? BigInt(q.cursor) : null, PAGE + 1);
    const items = rows.slice(0, PAGE);
    return {
      items: items.map(toEntry),
      nextCursor: rows.length > PAGE ? items[items.length - 1]!.chainSeq.toString() : null,
    };
  }

  /** Everything recorded about one application and the records that belong to it. */
  async applicationHistory(user: AuthUser, applicationId: string): Promise<AuditPage> {
    const app = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: { departmentId: true },
    });
    if (!app) throw new NotFoundException();
    if (user.role === 'SUPERVISOR' && user.departmentId !== app.departmentId)
      throw new ForbiddenException();
    const rows = await this.rows(
      [
        Prisma.sql`(
          (l."entityType" = 'Application' AND l."entityId" = ${applicationId})
          OR (l."entityType" = 'Payment' AND l."entityId" IN (SELECT p."id"::text FROM "payment" p WHERE p."applicationId" = ${applicationId}::uuid))
          OR (l."entityType" = 'Refund' AND l."entityId" IN (SELECT r."id"::text FROM "refund" r JOIN "payment" p ON p."id" = r."paymentId" WHERE p."applicationId" = ${applicationId}::uuid))
          OR (l."entityType" = 'Document' AND l."entityId" IN (SELECT d."id"::text FROM "document" d WHERE d."applicationId" = ${applicationId}::uuid))
          OR (l."entityType" = 'Certificate' AND l."entityId" IN (SELECT c."id"::text FROM "certificate" c WHERE c."applicationId" = ${applicationId}::uuid))
        )`,
      ],
      null,
      5000,
      'ASC',
    );
    return { items: rows.map(toEntry), nextCursor: null };
  }

  async export(
    user: AuthUser,
    q: AuditQuery,
    ctx: RequestContext,
    write: (chunk: string) => Promise<void>,
  ): Promise<void> {
    const where = this.where(user, q);
    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, {
        actor: { id: user.id, role: user.role, type: 'USER' },
        action: 'AUDIT_EXPORTED',
        entityType: 'AuditLog',
        entityId: 'export',
        departmentId: user.role === 'SUPERVISOR' ? user.departmentId : (q.departmentId ?? null),
        after: {
          filters: Object.fromEntries(
            Object.entries(q).filter(([k, v]) => v !== undefined && k !== 'cursor'),
          ),
        },
        ctx,
      }),
    );
    await write(
      csvRow([
        'Seq',
        'When',
        'Actor type',
        'Actor',
        'Role',
        'Action',
        'Entity',
        'Entity id',
        'Department',
        'Before',
        'After',
        'IP',
        'Request',
        'Hash',
      ]),
    );
    let cursor: bigint | null = null;
    let count = 0;
    while (count < EXPORT_CAP) {
      const want = Math.min(EXPORT_BATCH, EXPORT_CAP - count);
      const rows = await this.rows(where, cursor, want);
      if (rows.length === 0) return;
      await write(
        rows
          .map((r) =>
            csvRow([
              r.chainSeq,
              r.occurredAt.toISOString(),
              r.actorType,
              r.actorName ?? r.actorId,
              r.actorRole,
              r.action,
              r.entityType,
              r.entityId,
              r.departmentId,
              r.before === null ? '' : JSON.stringify(r.before),
              r.after === null ? '' : JSON.stringify(r.after),
              r.ip,
              r.requestId,
              Buffer.from(r.hash).toString('hex'),
            ]),
          )
          .join(''),
      );
      count += rows.length;
      cursor = rows[rows.length - 1]!.chainSeq;
      if (rows.length < want) return;
    }
    await write(
      csvRow([`Export stopped at ${EXPORT_CAP} rows. Narrow the filters to export the rest.`]),
    );
  }

  private where(user: AuthUser, q: AuditQuery): Prisma.Sql[] {
    const scope =
      user.role === 'SUPERVISOR'
        ? [Prisma.sql`l."departmentId" = ${user.departmentId}::uuid`]
        : user.role === 'ADMIN'
          ? q.departmentId
            ? [Prisma.sql`l."departmentId" = ${q.departmentId}::uuid`]
            : []
          : null;
    if (!scope || (user.role === 'SUPERVISOR' && !user.departmentId))
      throw new ForbiddenException();
    return [
      ...scope,
      ...(q.entityType ? [Prisma.sql`l."entityType" = ${q.entityType}`] : []),
      ...(q.entityId ? [Prisma.sql`l."entityId" = ${q.entityId}`] : []),
      ...(q.actorId ? [Prisma.sql`l."actorId" = ${q.actorId}::uuid`] : []),
      ...(q.action ? [Prisma.sql`l."action" = ${q.action}`] : []),
      ...(q.from ? [Prisma.sql`l."occurredAt" >= ${dayStart(q.from)}`] : []),
      ...(q.to
        ? [Prisma.sql`l."occurredAt" < ${new Date(dayStart(q.to).getTime() + 86_400_000)}`]
        : []),
    ];
  }

  private rows(
    where: Prisma.Sql[],
    before: bigint | null,
    limit: number,
    order: 'ASC' | 'DESC' = 'DESC',
  ): Promise<Row[]> {
    const parts = [...where, ...(before !== null ? [Prisma.sql`l."chainSeq" < ${before}`] : [])];
    return this.prisma.$queryRaw<Row[]>`
      SELECT l."chainSeq", l."occurredAt", l."actorId", u."fullName" AS "actorName", l."actorRole"::text AS "actorRole",
             l."actorType"::text AS "actorType", l."action", l."entityType", l."entityId", l."departmentId",
             l."before", l."after", l."ip", l."userAgent", l."requestId", l."hash"
      FROM "audit_log" l
      LEFT JOIN "user" u ON u."id" = l."actorId"
      WHERE ${parts.length ? Prisma.join(parts, ' AND ') : Prisma.sql`TRUE`}
      ORDER BY l."chainSeq" ${order === 'ASC' ? Prisma.sql`ASC` : Prisma.sql`DESC`}
      LIMIT ${limit}`;
  }
}

function toEntry(r: Row): AuditEntry {
  return {
    chainSeq: r.chainSeq.toString(),
    occurredAt: r.occurredAt.toISOString(),
    actorId: r.actorId,
    actorName: r.actorName,
    actorRole: r.actorRole,
    actorType: r.actorType,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    departmentId: r.departmentId,
    before: r.before ?? null,
    after: r.after ?? null,
    ip: r.ip,
    userAgent: r.userAgent,
    requestId: r.requestId,
    hash: Buffer.from(r.hash).toString('hex'),
  };
}
