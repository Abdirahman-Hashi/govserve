import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService, SYSTEM_ACTOR } from '../audit/audit.service';
import { type ApplicationStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_PORT, type StoragePort } from '../storage/storage.port';

const BATCH = 200;
const DAY = 86_400_000;

/**
 * Retention (FR-150–FR-152, DATA_MODEL §8). Uploaded files are deleted from storage but their
 * rows are kept (purgedAt). Certificates, receipts, payments and the audit log are never deleted.
 * Every purge writes an audit row in the same transaction as the purgedAt marker.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  /** Uploads of decided applications, `years` after the decision (default 7). */
  purgeDecidedDocuments(years: number, now = new Date()): Promise<number> {
    const cutoff = new Date(now);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
    return this.purgeDocuments(
      ['ISSUED', 'REJECTED', 'REFERRED'],
      cutoff,
      `DECIDED_${years}_YEARS`,
    );
  }

  /** Uploads of withdrawn or abandoned applications, `days` after they closed (default 90). */
  purgeClosedUploads(days: number, now = new Date()): Promise<number> {
    return this.purgeDocuments(
      ['WITHDRAWN', 'ABANDONED'],
      new Date(now.getTime() - days * DAY),
      `CLOSED_${days}_DAYS`,
    );
  }

  /** Dispatched outbox rows after `days` (notifications keep their own rows). */
  async pruneOutbox(days: number, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - days * DAY);
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.outboxEvent.deleteMany({
        where: { dispatchedAt: { lt: cutoff } },
      });
      if (count > 0) {
        await this.audit.record(tx, {
          actor: SYSTEM_ACTOR,
          action: 'RETENTION_PRUNED',
          entityType: 'Retention',
          entityId: 'outbox',
          after: { outboxEvents: count, olderThanDays: days },
        });
      }
      return count;
    });
  }

  /**
   * Deletes the stored objects first, then marks the rows and audits per application. A failed
   * object delete leaves the row unmarked, so the next night retries it.
   */
  private async purgeDocuments(
    statuses: ApplicationStatus[],
    cutoff: Date,
    reason: string,
  ): Promise<number> {
    const docs = await this.prisma.document.findMany({
      where: {
        purgedAt: null,
        application: {
          status: { in: statuses },
          OR: [{ decidedAt: { lt: cutoff } }, { decidedAt: null, updatedAt: { lt: cutoff } }],
        },
      },
      select: {
        id: true,
        storageKey: true,
        applicationId: true,
        application: { select: { departmentId: true } },
      },
      take: BATCH,
    });
    const byApp = new Map<string, { departmentId: string; ids: string[] }>();
    for (const d of docs) {
      const ok = await this.storage
        .delete(d.storageKey)
        .then(() => true)
        .catch((err: unknown) => {
          this.logger.warn(
            { documentId: d.id, err: (err as Error).name },
            'Could not delete stored object; will retry',
          );
          return false;
        });
      if (!ok || !d.applicationId || !d.application) continue;
      const entry = byApp.get(d.applicationId) ?? {
        departmentId: d.application.departmentId,
        ids: [],
      };
      entry.ids.push(d.id);
      byApp.set(d.applicationId, entry);
    }
    let purged = 0;
    for (const [applicationId, { departmentId, ids }] of byApp) {
      purged += await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.document.updateMany({
          where: { id: { in: ids }, purgedAt: null },
          data: { purgedAt: new Date() },
        });
        if (count > 0) {
          await this.audit.record(tx, {
            actor: SYSTEM_ACTOR,
            action: 'DOCUMENTS_PURGED',
            entityType: 'Application',
            entityId: applicationId,
            departmentId,
            after: { documents: count, reason },
          });
        }
        return count;
      });
    }
    if (purged > 0) this.logger.log({ purged, reason }, 'Purged uploaded documents');
    return purged;
  }
}
