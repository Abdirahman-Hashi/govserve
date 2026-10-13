import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type DepartmentCode,
  type InviteStaffRequest,
  type StaffInvitationResponse,
  type StaffMember,
  type UpdateStaffRequest,
} from '@govserve/shared';
import { ReviewService } from '../review/review.service';
import { AuditService, type AuditActor } from '../audit/audit.service';
import { AUTH_POLICY } from '../auth/auth.constants';
import { AuthService } from '../auth/auth.service';
import { type AuthUser } from '../auth/auth.types';
import { SessionRevocationService } from '../auth/session-revocation.service';
import { firstName, toSessionUser, type UserWithDepartment } from '../auth/session-user';
import { hashToken, TokenService } from '../auth/token.service';
import { type RequestContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { type Prisma } from '../generated/prisma/client';
import { NOTIFICATION_PORT, type NotificationPort } from '../notifications/notification.port';
import { PrismaService } from '../prisma/prisma.service';

const STAFF_ROLES = ['OFFICER', 'SUPERVISOR', 'ADMIN'] as const;

export interface CreatedInvitation {
  invitation: StaffInvitationResponse;
  link: string;
}

/** Staff account administration (FR-007, FR-009, FR-140). Admin only. */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly revocation: SessionRevocationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(NOTIFICATION_PORT) private readonly notifier: NotificationPort,
    private readonly review: ReviewService,
  ) {}

  async list(): Promise<StaffMember[]> {
    const users = await this.prisma.user.findMany({
      where: { role: { in: [...STAFF_ROLES] } },
      include: { department: true },
      orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
    });
    return users.map(toStaffMember);
  }

  /**
   * Creates an invitation and emails the one-time link. Also used by the admin bootstrap
   * script (actor SYSTEM), which prints the link instead of relying on email.
   */
  async invite(
    actor: AuditActor,
    body: InviteStaffRequest,
    ctx?: RequestContext,
  ): Promise<CreatedInvitation> {
    const departmentId = await this.departmentId(body.departmentCode ?? null);
    // Re-inviting a deactivated account is not supported yet: reactivation needs its own flow.
    if (await this.prisma.user.findUnique({ where: { email: body.email } })) {
      throw new ConflictException({
        code: 'EMAIL_IN_USE',
        message: 'An account with this email already exists',
      });
    }
    const token = AuthService.newInvitationToken();
    const expiresAt = new Date(Date.now() + AUTH_POLICY.invitationTtlHours * 3_600_000);

    const invitation = await this.prisma.$transaction(async (tx) => {
      // A new invitation replaces any pending one for the same email.
      await tx.staffInvitation.updateMany({
        where: { email: body.email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const created = await tx.staffInvitation.create({
        data: {
          email: body.email,
          fullName: body.fullName,
          role: body.role,
          departmentId,
          tokenHash: hashToken(token),
          invitedById: actor.id,
          expiresAt,
        },
      });
      await this.audit.record(tx, {
        actor,
        action: 'USER_INVITED',
        entityType: 'StaffInvitation',
        entityId: created.id,
        departmentId,
        after: { role: body.role, departmentId },
        ...(ctx && { ctx }),
      });
      return created;
    });

    const link = `${this.config.WEB_ORIGIN}/invitation?token=${encodeURIComponent(token)}`;
    await this.notifier.send({
      to: body.email,
      template: 'STAFF_INVITATION',
      vars: { firstName: firstName(body.fullName), role: body.role.toLowerCase(), link },
    });
    return {
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: body.role,
        expiresAt: expiresAt.toISOString(),
      },
      link,
    };
  }

  /** Changes role and/or department; the user must sign in again for it to take effect. */
  async update(
    caller: AuthUser,
    userId: string,
    body: UpdateStaffRequest,
    ctx: RequestContext,
  ): Promise<StaffMember> {
    if (userId === caller.id) {
      throw new BadRequestException({
        code: 'CANNOT_CHANGE_SELF',
        message: 'You cannot change your own role',
      });
    }
    const departmentId = await this.departmentId(body.departmentCode ?? null);
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.staffOrThrow(tx, userId);
      const user = await tx.user.update({
        where: { id: userId },
        data: { role: body.role, departmentId, version: { increment: 1 } },
        include: { department: true },
      });
      await this.tokens.revokeAllForUser(tx, userId, 'ROLE_CHANGED');
      await this.audit.record(tx, {
        actor: { id: caller.id, role: caller.role, type: 'USER' },
        action: 'USER_ROLE_CHANGED',
        entityType: 'User',
        entityId: userId,
        departmentId,
        before: { role: before.role, departmentId: before.departmentId },
        after: { role: user.role, departmentId: user.departmentId },
        ctx,
      });
      return user;
    });
    await this.revocation.revokeAllBefore(userId);
    return toStaffMember(updated);
  }

  /** FR-009: revokes sessions at once and releases claimed work. */
  async deactivate(caller: AuthUser, userId: string, ctx: RequestContext): Promise<StaffMember> {
    if (userId === caller.id) {
      throw new BadRequestException({
        code: 'CANNOT_CHANGE_SELF',
        message: 'You cannot deactivate yourself',
      });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.staffOrThrow(tx, userId);
      const user = await tx.user.update({
        where: { id: userId },
        data: { status: 'DEACTIVATED', version: { increment: 1 } },
        include: { department: true },
      });
      await this.tokens.revokeAllForUser(tx, userId, 'DEACTIVATED');
      await tx.trustedDevice.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.review.releaseClaimsOf(tx, userId);
      await this.audit.record(tx, {
        actor: { id: caller.id, role: caller.role, type: 'USER' },
        action: 'USER_DEACTIVATED',
        entityType: 'User',
        entityId: userId,
        departmentId: before.departmentId,
        before: { status: before.status },
        after: { status: 'DEACTIVATED' },
        ctx,
      });
      return user;
    });
    await this.revocation.revokeAllBefore(userId);
    return toStaffMember(updated);
  }

  private async staffOrThrow(tx: Prisma.TransactionClient, userId: string) {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.role === 'CITIZEN') throw new NotFoundException();
    return user;
  }

  private async departmentId(code: DepartmentCode | null): Promise<string | null> {
    if (!code) return null;
    const dept = await this.prisma.department.findUnique({ where: { code } });
    if (!dept)
      throw new BadRequestException({ code: 'UNKNOWN_DEPARTMENT', message: 'Unknown department' });
    return dept.id;
  }
}

function toStaffMember(user: UserWithDepartment): StaffMember {
  return {
    ...toSessionUser(user),
    status: user.status,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}
