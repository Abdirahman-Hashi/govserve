import { Injectable, Logger } from '@nestjs/common';
import { type AuditVerification } from '@govserve/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Verifies the audit hash chain (FR-131, ADR-0010). `audit_verify()` recomputes every hash and
 * link in the database; the checkpoint from the previous run catches rows removed from the end,
 * which a chain alone cannot see. A break notifies every admin (AUDIT_CHAIN_BROKEN).
 */
@Injectable()
export class AuditVerifierService {
  private readonly logger = new Logger(AuditVerifierService.name);

  constructor(private readonly prisma: PrismaService) {}

  async verify(): Promise<AuditVerification> {
    const verifiedAt = new Date();
    const [{ rows }] = await this.prisma.$queryRaw<
      [{ rows: number }]
    >`SELECT COUNT(*)::int AS "rows" FROM "audit_log"`;
    const [first] = await this.prisma.$queryRaw<
      { chainSeq: bigint; problem: 'LINK_BROKEN' | 'ROW_CHANGED' }[]
    >`
      SELECT "chainSeq", "problem" FROM audit_verify()`;
    let broken: AuditVerification['broken'] = first
      ? { chainSeq: first.chainSeq.toString(), problem: first.problem }
      : null;

    if (!broken) {
      // The last verified row must still be there, unchanged.
      const checkpoint = await this.prisma.auditCheckpoint.findFirst({ orderBy: { id: 'desc' } });
      if (checkpoint) {
        const row = await this.prisma.auditLog.findUnique({
          where: { chainSeq: checkpoint.chainSeq },
        });
        if (!row?.hash || !Buffer.from(row.hash).equals(Buffer.from(checkpoint.hash))) {
          broken = { chainSeq: checkpoint.chainSeq.toString(), problem: 'TAIL_REMOVED' };
        }
      }
    }

    if (broken) {
      this.logger.error(
        { chainSeq: broken.chainSeq, problem: broken.problem },
        'Audit chain verification failed',
      );
      await this.prisma.outboxEvent.create({
        data: {
          type: 'AUDIT_CHAIN_BROKEN',
          aggregateType: 'AuditLog',
          aggregateId: broken.chainSeq,
          payload: { chainSeq: broken.chainSeq, problem: broken.problem },
        },
      });
    } else {
      const last = await this.prisma.auditLog.findFirst({
        orderBy: { chainSeq: 'desc' },
        where: { chainSeq: { not: null } },
      });
      if (last?.chainSeq && last.hash) {
        await this.prisma.auditCheckpoint.create({
          data: { chainSeq: last.chainSeq, hash: last.hash, verifiedAt },
        });
      }
    }
    return { ok: !broken, rows, verifiedAt: verifiedAt.toISOString(), broken };
  }
}
