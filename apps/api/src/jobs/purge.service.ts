import { Injectable, Logger } from '@nestjs/common';
import { AuditService, SYSTEM_ACTOR } from '../audit/audit.service';
import { AUTH_POLICY } from '../auth/auth.constants';
import { PrismaService } from '../prisma/prisma.service';

/** Retention jobs owned by the auth module (FR-002, DATA_MODEL §8). */
@Injectable()
export class PurgeService {
  private readonly logger = new Logger(PurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Deletes citizen accounts never verified within 7 days. Returns how many were removed. */
  async purgeUnverifiedCitizens(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - AUTH_POLICY.unverifiedAccountTtlDays * 86_400_000);
    const stale = await this.prisma.user.findMany({
      where: { role: 'CITIZEN', emailVerifiedAt: null, createdAt: { lt: cutoff } },
      select: { id: true },
      take: 500,
    });
    for (const { id } of stale) {
      await this.prisma.$transaction(async (tx) => {
        // Re-check inside the transaction: the user may have verified meanwhile.
        const deleted = await tx.user.deleteMany({ where: { id, emailVerifiedAt: null } });
        if (deleted.count === 0) return;
        await this.audit.record(tx, {
          actor: SYSTEM_ACTOR,
          action: 'USER_PURGED',
          entityType: 'User',
          entityId: id,
          after: { reason: 'UNVERIFIED_7_DAYS' },
        });
      });
    }
    if (stale.length > 0)
      this.logger.log({ count: stale.length }, 'Purged unverified citizen accounts');
    return stale.length;
  }

  /** Removes expired one-time codes and long-expired refresh tokens (30 days after expiry). */
  async pruneAuthArtifacts(now = new Date()): Promise<void> {
    const cutoff = new Date(now.getTime() - 30 * 86_400_000);
    await this.prisma.otpCode.deleteMany({ where: { expiresAt: { lt: cutoff } } });
    await this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  }
}
