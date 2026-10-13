import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Profile, type UpdateProfileRequest } from '@govserve/shared';
import { AuditService } from '../audit/audit.service';
import { type AuthUser } from '../auth/auth.types';
import { OtpService } from '../auth/otp.service';
import { firstName, toSessionUser, type UserWithDepartment } from '../auth/session-user';
import { assertCitizenOwns } from '../common/guards/scope';
import { type RequestContext } from '../common/request-context';
import { CryptoService } from '../crypto/crypto.service';
import { type CitizenProfile, Prisma } from '../generated/prisma/client';
import { DirectNotifier } from '../notifications/direct-notifier.service';
import { PrismaService } from '../prisma/prisma.service';

type UserForProfile = UserWithDepartment & { citizenProfile: CitizenProfile | null };

const CITIZEN_ONLY_FIELDS = ['nationalIdType', 'nationalId', 'dateOfBirth'] as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly otp: OtpService,
    private readonly notifier: DirectNotifier,
  ) {}

  async profile(caller: AuthUser, userId: string): Promise<Profile> {
    assertCitizenOwns(caller, userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { department: true, citizenProfile: true },
    });
    if (!user) throw new NotFoundException();
    return this.toProfile(user);
  }

  async updateMe(
    caller: AuthUser,
    body: UpdateProfileRequest,
    ctx: RequestContext,
  ): Promise<Profile> {
    const citizenFields = CITIZEN_ONLY_FIELDS.filter((f) => body[f] !== undefined);
    if (caller.role !== 'CITIZEN' && citizenFields.length > 0) {
      throw new ForbiddenException({
        code: 'CITIZEN_ONLY_FIELDS',
        message: 'Only citizens have identity details',
      });
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: caller.id },
          data: {
            ...(body.fullName !== undefined && { fullName: body.fullName }),
            ...(body.phone !== undefined && {
              phoneEnc: this.crypto.encrypt(body.phone),
              phoneBidx: this.crypto.blindIndex('phone', body.phone),
            }),
          },
        });
        if (caller.role === 'CITIZEN' && citizenFields.length > 0) {
          const data = {
            ...(body.nationalIdType !== undefined && { nationalIdType: body.nationalIdType }),
            ...(body.nationalId !== undefined && {
              nationalIdEnc: this.crypto.encrypt(body.nationalId),
              nationalIdBidx: this.crypto.blindIndex('nationalId', body.nationalId),
            }),
            ...(body.dateOfBirth !== undefined && {
              dateOfBirthEnc: this.crypto.encrypt(body.dateOfBirth),
            }),
          };
          await tx.citizenProfile.upsert({
            where: { userId: caller.id },
            create: { userId: caller.id, ...data },
            update: data,
          });
        }
        await this.audit.record(tx, {
          actor: { id: caller.id, role: caller.role, type: 'USER' },
          action: 'USER_PROFILE_UPDATED',
          entityType: 'User',
          entityId: caller.id,
          // Field names only: values are PII.
          after: {
            fields: Object.keys(body).filter(
              (k) => body[k as keyof UpdateProfileRequest] !== undefined,
            ),
          },
          ctx,
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'NATIONAL_ID_IN_USE',
          message: 'This ID number is already registered',
        });
      }
      throw err;
    }
    return this.profile(caller, caller.id);
  }

  /** Sends a confirmation code to the new address (FR-010); the change happens on confirm. */
  async requestEmailChange(caller: AuthUser, newEmail: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: caller.id } });
    if (user.email === newEmail) return;
    if (await this.prisma.user.findUnique({ where: { email: newEmail } })) {
      throw new ConflictException({
        code: 'EMAIL_IN_USE',
        message: 'An account with this email already exists',
      });
    }
    const { code } = await this.prisma.$transaction((tx) =>
      this.otp.issue(tx, { email: newEmail, purpose: 'CHANGE_EMAIL', userId: caller.id }),
    );
    await this.notifier.send({
      to: newEmail,
      template: 'CHANGE_EMAIL_CODE',
      vars: { firstName: firstName(user.fullName), code },
    });
  }

  async confirmEmailChange(caller: AuthUser, code: string, ctx: RequestContext): Promise<Profile> {
    await this.prisma.$transaction(async (tx) => {
      const check = await this.otp.verify(tx, { userId: caller.id, purpose: 'CHANGE_EMAIL', code });
      if (!check.ok) {
        throw new ConflictException({
          code: `CODE_${check.reason}`,
          message: 'The code is incorrect or has expired',
        });
      }
      try {
        await tx.user.update({
          where: { id: caller.id },
          data: { email: check.otp.email, emailVerifiedAt: new Date() },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException({
            code: 'EMAIL_IN_USE',
            message: 'An account with this email already exists',
          });
        }
        throw err;
      }
      await this.audit.record(tx, {
        actor: { id: caller.id, role: caller.role, type: 'USER' },
        action: 'USER_EMAIL_CHANGED',
        entityType: 'User',
        entityId: caller.id,
        ctx,
      });
    });
    return this.profile(caller, caller.id);
  }

  toProfile(user: UserForProfile): Profile {
    const nationalId = this.crypto.decryptOptional(user.citizenProfile?.nationalIdEnc);
    return {
      ...toSessionUser(user),
      phone: this.crypto.decryptOptional(user.phoneEnc),
      nationalIdType: user.citizenProfile?.nationalIdType ?? null,
      nationalIdMasked: nationalId ? maskTail(nationalId) : null,
      dateOfBirth: this.crypto.decryptOptional(user.citizenProfile?.dateOfBirthEnc),
    };
  }
}

/** Shows only the last 3 characters, e.g. "•••••567". */
export function maskTail(value: string): string {
  return value.length <= 3
    ? '•'.repeat(value.length)
    : '•'.repeat(value.length - 3) + value.slice(-3);
}
