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

  /** Deletes citizen accounts never verified within `days` (default 7). Returns how many were removed. */
  async purgeUnverifiedCitizens(
    days: number = AUTH_POLICY.unverifiedAccountTtlDays,
    now = new Date(),
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - days * 86_400_000);
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
          after: { reason: 'UNVERIFIED', olderThanDays: days },
        });
      });
    }
    if (stale.length > 0)
      this.logger.log({ count: stale.length }, 'Purged unverified citizen accounts');
    return stale.length;
  }

  /** Removes expired one-time codes and long-expired refresh tokens; one audit row with the counts. */
  async pruneAuthArtifacts(
    days: number,
    now = new Date(),
  ): Promise<{ otpCodes: number; refreshTokens: number }> {
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    return this.prisma.$transaction(async (tx) => {
      const otp = await tx.otpCode.deleteMany({ where: { expiresAt: { lt: cutoff } } });
      const tokens = await tx.refreshToken.deleteMany({ where: { expiresAt: { lt: cutoff } } });
      if (otp.count + tokens.count > 0) {
        await this.audit.record(tx, {
          actor: SYSTEM_ACTOR,
          action: 'RETENTION_PRUNED',
          entityType: 'Retention',
          entityId: 'auth-artifacts',
          after: { otpCodes: otp.count, refreshTokens: tokens.count, olderThanDays: days },
        });
      }
      return { otpCodes: otp.count, refreshTokens: tokens.count };
    });
  }
}
