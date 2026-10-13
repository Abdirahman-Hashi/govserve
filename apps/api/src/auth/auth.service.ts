import { DirectNotifier } from '../notifications/direct-notifier.service';
import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  type AcceptInvitationRequest,
  type AuthSession,
  type LoginRequest,
  type RegisterRequest,
  type ResetPasswordRequest,
} from '@govserve/shared';
import { AuditService, PUBLIC_ACTOR, SYSTEM_ACTOR, type AuditActor } from '../audit/audit.service';
import { type RequestContext } from '../common/request-context';
import { CryptoService } from '../crypto/crypto.service';
import { type NotificationMessage } from '../notifications/notification.port';
import { NotificationDeliveryError } from '../notifications/notification-delivery.error';
import { PrismaService } from '../prisma/prisma.service';
import { AUTH_POLICY } from './auth.constants';
import { AFTER_SUCCESS, afterFailure, isLocked } from './lockout';
import { OtpService, type OtpCheck } from './otp.service';
import { PasswordService } from './password.service';
import { SessionRevocationService } from './session-revocation.service';
import { firstName, toSessionUser, toTokenSubject, type UserWithDepartment } from './session-user';
import { hashToken, TokenService } from './token.service';

/** A session plus the refresh token the controller puts in the httpOnly cookie. */
export interface IssuedSession {
  session: AuthSession;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export type LoginOutcome =
  { status: 'OK'; issued: IssuedSession } | { status: 'OTP_REQUIRED'; challengeId: string };

const invalidCredentials = () =>
  new UnauthorizedException({
    code: 'INVALID_CREDENTIALS',
    message: 'Email or password is incorrect',
  });

const actorOf = (user: { id: string; role: AuditActor['role'] }): AuditActor => ({
  id: user.id,
  role: user.role,
  type: 'USER',
});

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly revocation: SessionRevocationService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly notifier: DirectNotifier,
  ) {}

  // ─── Registration (FR-001, FR-002) ─────────────────────────────────────────

  /** Always answers the same way, so registration cannot be used to probe for accounts. */
  async register(body: RegisterRequest, ctx: RequestContext): Promise<void> {
    this.passwords.assertAcceptable(body.password, body);
    const passwordHash = await this.passwords.hash(body.password);

    const message = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: body.email } });
      if (existing) return null;
      const user = await tx.user.create({
        data: {
          email: body.email,
          fullName: body.fullName,
          passwordHash,
          role: 'CITIZEN',
          phoneEnc: this.crypto.encrypt(body.phone),
          phoneBidx: this.crypto.blindIndex('phone', body.phone),
          citizenProfile: { create: {} },
        },
      });
      await this.audit.record(tx, {
        actor: actorOf(user),
        action: 'USER_REGISTERED',
        entityType: 'User',
        entityId: user.id,
        after: { role: 'CITIZEN' },
        ctx,
      });
      const { code } = await this.otp.issue(tx, {
        email: user.email,
        purpose: 'VERIFY_EMAIL',
        userId: user.id,
      });
      return this.codeMessage(user.email, 'VERIFY_EMAIL_CODE', user.fullName, code);
    });
    if (message) await this.send(message);
  }

  /** Verifies the email and signs the citizen in. */
  async verifyEmail(email: string, code: string, ctx: RequestContext): Promise<IssuedSession> {
    const user = await this.prisma.$transaction(async (tx) => {
      const check = await this.otp.verify(tx, { email, purpose: 'VERIFY_EMAIL', code });
      if (!check.ok || !check.otp.userId) return otpFailure(check);
      const updated = await tx.user.update({
        where: { id: check.otp.userId },
        data: { emailVerifiedAt: new Date() },
        include: { department: true },
      });
      await this.audit.record(tx, {
        actor: actorOf(updated),
        action: 'USER_EMAIL_VERIFIED',
        entityType: 'User',
        entityId: updated.id,
        ctx,
      });
      return updated;
    });
    return this.startSession(user, ctx, { mfa: false });
  }

  async resendVerification(email: string): Promise<void> {
    const message = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { email } });
      if (!user || user.emailVerifiedAt || user.status !== 'ACTIVE') return null;
      if (await this.otp.recentlyIssued(tx, email, 'VERIFY_EMAIL')) return null;
      const { code } = await this.otp.issue(tx, {
        email,
        purpose: 'VERIFY_EMAIL',
        userId: user.id,
      });
      return this.codeMessage(email, 'VERIFY_EMAIL_CODE', user.fullName, code);
    });
    if (message) await this.send(message);
  }

  // ─── Login (FR-004, FR-006, FR-008) ────────────────────────────────────────

  async login(body: LoginRequest, deviceId: string, ctx: RequestContext): Promise<LoginOutcome> {
    const now = new Date();
    const user = await this.prisma.user.findUnique({
      where: { email: body.email },
      include: { department: true },
    });
    const passwordOk = await this.passwords.verify(user?.passwordHash, body.password);

    if (!user || user.status === 'DEACTIVATED' || isLocked(user, now) || !passwordOk) {
      await this.recordFailedLogin(user, passwordOk, now, ctx);
      throw invalidCredentials();
    }
    if (user.role === 'CITIZEN' && !user.emailVerifiedAt) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your email address first',
      });
    }

    if (user.role !== 'CITIZEN') {
      const deviceIdHash = this.crypto.keyedHash('device', deviceId);
      const trusted = await this.prisma.trustedDevice.findFirst({
        where: { userId: user.id, deviceIdHash, revokedAt: null, expiresAt: { gt: now } },
      });
      if (!trusted) {
        const { id, code } = await this.prisma.$transaction((tx) =>
          this.otp.issue(tx, {
            email: user.email,
            purpose: 'STAFF_DEVICE',
            userId: user.id,
            contextHash: deviceIdHash,
          }),
        );
        await this.send(this.codeMessage(user.email, 'STAFF_DEVICE_CODE', user.fullName, code));
        return { status: 'OTP_REQUIRED', challengeId: id };
      }
      await this.prisma.trustedDevice.update({
        where: { id: trusted.id },
        data: { lastSeenAt: now },
      });
    }
    return { status: 'OK', issued: await this.startSession(user, ctx, { mfa: false }) };
  }

  /** Completes a staff login from a new device; the device is then trusted for 30 days. */
  async completeDeviceChallenge(
    challengeId: string,
    code: string,
    deviceId: string,
    ctx: RequestContext,
  ): Promise<IssuedSession> {
    const now = new Date();
    const deviceIdHash = this.crypto.keyedHash('device', deviceId);
    const user = await this.prisma.$transaction(async (tx) => {
      const challenge = await tx.otpCode.findUnique({ where: { id: challengeId } });
      // The code only works from the browser it was issued to.
      if (
        !challenge ||
        challenge.purpose !== 'STAFF_DEVICE' ||
        challenge.contextHash !== deviceIdHash
      ) {
        return otpFailure({ ok: false, reason: 'INVALID' });
      }
      const check = await this.otp.verify(tx, { id: challengeId, purpose: 'STAFF_DEVICE', code });
      if (!check.ok || !check.otp.userId) return otpFailure(check);
      const found = await tx.user.findUnique({
        where: { id: check.otp.userId },
        include: { department: true },
      });
      if (!found || found.status === 'DEACTIVATED' || isLocked(found, now))
        throw invalidCredentials();
      await tx.trustedDevice.upsert({
        where: { userId_deviceIdHash: { userId: found.id, deviceIdHash } },
        create: {
          userId: found.id,
          deviceIdHash,
          expiresAt: addDays(now, AUTH_POLICY.trustedDeviceDays),
        },
        update: {
          revokedAt: null,
          lastSeenAt: now,
          expiresAt: addDays(now, AUTH_POLICY.trustedDeviceDays),
        },
      });
      // Trusting a device widens what counts as a valid sign-in: audit it in this transaction.
      await this.audit.record(tx, {
        actor: actorOf(found),
        action: 'DEVICE_TRUSTED',
        entityType: 'User',
        entityId: found.id,
        departmentId: found.departmentId,
        after: { trustedDays: AUTH_POLICY.trustedDeviceDays },
        ctx,
      });
      return found;
    });
    return this.startSession(user, ctx, { mfa: true });
  }

  // ─── Refresh and logout (FR-006) ───────────────────────────────────────────

  async refresh(refreshToken: string, ctx: RequestContext): Promise<IssuedSession> {
    const result = await this.prisma.$transaction(async (tx) => {
      const rotated = await this.tokens.rotate(tx, refreshToken, ctx);
      if (rotated.status === 'REUSED') {
        await this.audit.record(tx, {
          actor: SYSTEM_ACTOR,
          action: 'AUTH_REFRESH_REUSE',
          entityType: 'User',
          entityId: rotated.userId,
          after: { familyRevoked: true },
          ctx,
        });
        return { kind: 'REUSED', userId: rotated.userId } as const;
      }
      if (rotated.status !== 'OK') return null;
      const user = await tx.user.findUnique({
        where: { id: rotated.userId },
        include: { department: true },
      });
      if (!user || user.status === 'DEACTIVATED') {
        await this.tokens.revokeFamily(tx, rotated.refresh.familyId, 'USER_INACTIVE');
        return null;
      }
      return { kind: 'OK', user, refresh: rotated.refresh } as const;
    });
    if (result?.kind === 'REUSED') await this.revocation.revokeAllBefore(result.userId);
    if (result?.kind !== 'OK') {
      throw new UnauthorizedException({ code: 'SESSION_EXPIRED', message: 'Please sign in again' });
    }
    return this.sessionFrom(
      result.user,
      result.refresh.token,
      result.refresh.familyId,
      result.refresh.expiresAt,
    );
  }

  async logout(refreshToken: string | undefined, ctx: RequestContext): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.$transaction(async (tx) => {
      const revoked = await this.tokens.revokeByToken(tx, refreshToken, 'LOGOUT');
      if (!revoked) return;
      const user = await tx.user.findUnique({ where: { id: revoked.userId } });
      await this.audit.record(tx, {
        actor: user ? actorOf(user) : SYSTEM_ACTOR,
        action: 'AUTH_LOGOUT',
        entityType: 'User',
        entityId: revoked.userId,
        ctx,
      });
    });
  }

  // ─── Password reset (FR-005) ───────────────────────────────────────────────

  async forgotPassword(email: string): Promise<void> {
    const message = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { email } });
      if (!user || user.status === 'DEACTIVATED' || !user.passwordHash) return null;
      if (await this.otp.recentlyIssued(tx, email, 'RESET_PASSWORD')) return null;
      const { code } = await this.otp.issue(tx, {
        email,
        purpose: 'RESET_PASSWORD',
        userId: user.id,
      });
      return this.codeMessage(email, 'RESET_PASSWORD_CODE', user.fullName, code);
    });
    if (message) await this.send(message);
  }

  async resetPassword(body: ResetPasswordRequest, ctx: RequestContext): Promise<void> {
    this.passwords.assertAcceptable(body.password, body);
    const passwordHash = await this.passwords.hash(body.password);
    const userId = await this.prisma.$transaction(async (tx) => {
      const check = await this.otp.verify(tx, {
        email: body.email,
        purpose: 'RESET_PASSWORD',
        code: body.code,
      });
      if (!check.ok || !check.otp.userId) return otpFailure(check);
      const current = await tx.user.findUnique({ where: { id: check.otp.userId } });
      // A code issued before deactivation must not bring the account back.
      if (!current || current.status === 'DEACTIVATED')
        return otpFailure({ ok: false, reason: 'INVALID' });
      const user = await tx.user.update({
        where: { id: current.id },
        data: {
          passwordHash,
          ...AFTER_SUCCESS,
          status: 'ACTIVE',
          // A reset code proves control of the mailbox, which also verifies it.
          emailVerifiedAt: current.emailVerifiedAt ?? new Date(),
        },
      });
      await this.tokens.revokeAllForUser(tx, user.id, 'PASSWORD_RESET');
      await this.audit.record(tx, {
        actor: actorOf(user),
        action: 'PASSWORD_RESET',
        entityType: 'User',
        entityId: user.id,
        after: { sessionsRevoked: true },
        ctx,
      });
      return user.id;
    });
    await this.revocation.revokeAllBefore(userId);
  }

  // ─── Staff invitations (FR-007) ────────────────────────────────────────────

  async acceptInvitation(body: AcceptInvitationRequest, ctx: RequestContext): Promise<void> {
    const now = new Date();
    const invitation = await this.prisma.staffInvitation.findUnique({
      where: { tokenHash: hashToken(body.token) },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= now
    ) {
      throw new BadRequestException({
        code: 'INVITATION_INVALID',
        message: 'This invitation link is invalid or has expired',
      });
    }
    this.passwords.assertAcceptable(body.password, {
      email: invitation.email,
      fullName: invitation.fullName,
    });
    const passwordHash = await this.passwords.hash(body.password);

    await this.prisma.$transaction(async (tx) => {
      // Accept at most once, even with two concurrent submissions.
      const claimed = await tx.staffInvitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: now },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException({
          code: 'INVITATION_INVALID',
          message: 'This invitation link is invalid or has expired',
        });
      }
      if (await tx.user.findUnique({ where: { email: invitation.email } })) {
        throw new ConflictException({
          code: 'EMAIL_IN_USE',
          message: 'An account with this email already exists',
        });
      }
      const user = await tx.user.create({
        data: {
          email: invitation.email,
          fullName: invitation.fullName,
          role: invitation.role,
          departmentId: invitation.departmentId,
          passwordHash,
          emailVerifiedAt: now,
        },
      });
      await this.audit.record(tx, {
        actor: actorOf(user),
        action: 'USER_CREATED',
        entityType: 'User',
        entityId: user.id,
        departmentId: user.departmentId,
        after: { role: user.role, departmentId: user.departmentId, invitationId: invitation.id },
        ctx,
      });
    });
  }

  /** Creates an invitation and returns the one-time token (only ever shown once). */
  static newInvitationToken(): string {
    return randomBytes(32).toString('base64url');
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async startSession(
    user: UserWithDepartment,
    ctx: RequestContext,
    meta: { mfa: boolean },
  ): Promise<IssuedSession> {
    const refresh = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          ...AFTER_SUCCESS,
          ...(user.status === 'LOCKED' && { status: 'ACTIVE' }),
        },
      });
      const issued = await this.tokens.issueRefresh(tx, user.id, ctx);
      await this.audit.record(tx, {
        actor: actorOf(user),
        action: 'AUTH_LOGIN',
        entityType: 'User',
        entityId: user.id,
        departmentId: user.departmentId,
        after: { mfa: meta.mfa },
        ctx,
      });
      return issued;
    });
    return this.sessionFrom(user, refresh.token, refresh.familyId, refresh.expiresAt);
  }

  private async sessionFrom(
    user: UserWithDepartment,
    refreshToken: string,
    familyId: string,
    refreshExpiresAt: Date,
  ): Promise<IssuedSession> {
    const accessToken = await this.tokens.signAccess(toTokenSubject(user), familyId);
    return {
      session: {
        accessToken,
        expiresIn: AUTH_POLICY.accessTokenTtlSeconds,
        user: toSessionUser(user),
      },
      refreshToken,
      refreshExpiresAt,
    };
  }

  private async recordFailedLogin(
    user: UserWithDepartment | null,
    passwordOk: boolean,
    now: Date,
    ctx: RequestContext,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (!user) {
        await this.audit.record(tx, {
          actor: PUBLIC_ACTOR,
          action: 'AUTH_LOGIN_FAILED',
          entityType: 'User',
          entityId: 'unknown',
          after: { reason: 'UNKNOWN_ACCOUNT' },
          ctx,
        });
        return;
      }
      const reason =
        user.status === 'DEACTIVATED'
          ? 'DEACTIVATED'
          : isLocked(user, now)
            ? 'LOCKED'
            : 'BAD_PASSWORD';
      let locked = false;
      if (reason === 'BAD_PASSWORD' && !passwordOk) {
        const next = afterFailure(user, now);
        locked = next.justLocked;
        await tx.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: next.failedLoginCount,
            failedLoginAt: next.failedLoginAt,
            lockedUntil: next.lockedUntil,
            ...(locked && { status: 'LOCKED' }),
          },
        });
      }
      await this.audit.record(tx, {
        actor: PUBLIC_ACTOR,
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'User',
        entityId: user.id,
        departmentId: user.departmentId,
        after: { reason },
        ctx,
      });
      if (locked) {
        await this.audit.record(tx, {
          actor: SYSTEM_ACTOR,
          action: 'AUTH_LOCKED',
          entityType: 'User',
          entityId: user.id,
          departmentId: user.departmentId,
          after: { lockMinutes: AUTH_POLICY.lockout.lockMinutes },
          ctx,
        });
      }
    });
  }

  private codeMessage(
    to: string,
    template: NotificationMessage['template'],
    fullName: string,
    code: string,
  ): NotificationMessage {
    return { to, template, vars: { firstName: firstName(fullName), code } };
  }

  /** Email failures are logged, not surfaced: the user can ask for a new code. */
  private async send(message: NotificationMessage): Promise<void> {
    try {
      await this.notifier.send(message);
    } catch (err) {
      // Adapters throw NotificationDeliveryError (no addresses); log nothing else from the error.
      const safe =
        err instanceof NotificationDeliveryError
          ? err
          : NotificationDeliveryError.from(message.template, err);
      this.logger.error(
        {
          template: safe.template,
          transportCode: safe.transportCode,
          responseCode: safe.responseCode,
        },
        'Failed to send notification',
      );
    }
  }
}

function otpFailure(check: OtpCheck): never {
  const reason = check.ok ? 'INVALID' : check.reason;
  const messages = {
    INVALID: 'The code is incorrect',
    EXPIRED: 'The code has expired. Request a new one',
    TOO_MANY_ATTEMPTS: 'Too many attempts. Request a new code',
  } as const;
  throw new BadRequestException({ code: `CODE_${reason}`, message: messages[reason] });
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
