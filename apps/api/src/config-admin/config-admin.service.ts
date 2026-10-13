import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type CreateHolidayRequest,
  type CreateReasonCodeRequest,
  type Holiday,
  type ReasonCode,
  type Setting,
  SETTING_KEYS,
  type SettingKey,
  SettingSchemas,
  type UpdateReasonCodeRequest,
} from '@govserve/shared';
import { AuditService } from '../audit/audit.service';
import { type AuthUser } from '../auth/auth.types';
import { type RequestContext } from '../common/request-context';
import {
  Prisma,
  type ReasonCode as ReasonCodeRow,
  type ReasonCodeKind,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const actor = (u: AuthUser) => ({ id: u.id, role: u.role, type: 'USER' as const });
const isSettingKey = (key: string): key is SettingKey => (SETTING_KEYS as string[]).includes(key);
const toReasonCode = (r: ReasonCodeRow): ReasonCode => ({
  id: r.id,
  kind: r.kind,
  code: r.code,
  label: r.label,
  active: r.active,
});

/** System settings, public holidays and reason codes (FR-140). Admin only; every change audited. */
@Injectable()
export class ConfigAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listSettings(): Promise<Setting[]> {
    const rows = await this.prisma.setting.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return SETTING_KEYS.filter((k) => byKey.has(k)).map((key) => {
      const row = byKey.get(key)!;
      return { key, value: row.value, updatedAt: row.updatedAt.toISOString() };
    });
  }

  async updateSetting(
    user: AuthUser,
    key: string,
    value: unknown,
    ctx: RequestContext,
  ): Promise<Setting> {
    if (!isSettingKey(key))
      throw new NotFoundException({ code: 'UNKNOWN_SETTING', message: `Unknown setting "${key}"` });
    const parsed = SettingSchemas[key].safeParse(value);
    if (!parsed.success) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'Invalid value for this setting',
        details: parsed.error.issues.map((i) => ({
          path: ['value', ...i.path].join('.'),
          message: i.message,
        })),
      });
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const before = await tx.setting.findUnique({ where: { key } });
      const saved = await tx.setting.upsert({
        where: { key },
        create: { key, value: parsed.data, updatedById: user.id },
        update: { value: parsed.data, updatedById: user.id },
      });
      await this.audit.record(tx, {
        actor: actor(user),
        action: 'SETTING_UPDATED',
        entityType: 'Setting',
        entityId: key,
        before: { value: (before?.value ?? null) as Prisma.InputJsonValue },
        after: { value: parsed.data as Prisma.InputJsonValue },
        ctx,
      });
      return saved;
    });
    return { key, value: row.value, updatedAt: row.updatedAt.toISOString() };
  }

  async listHolidays(): Promise<Holiday[]> {
    const rows = await this.prisma.holiday.findMany({ orderBy: { date: 'asc' } });
    return rows.map((h) => ({ date: h.date.toISOString().slice(0, 10), name: h.name }));
  }

  async addHoliday(
    user: AuthUser,
    body: CreateHolidayRequest,
    ctx: RequestContext,
  ): Promise<Holiday> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.holiday.create({
          data: { date: new Date(`${body.date}T00:00:00Z`), name: body.name },
        });
        await this.audit.record(tx, {
          actor: actor(user),
          action: 'HOLIDAY_ADDED',
          entityType: 'Holiday',
          entityId: body.date,
          after: body,
          ctx,
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'HOLIDAY_EXISTS',
          message: 'That date is already a holiday',
        });
      }
      throw err;
    }
    return body;
  }

  async removeHoliday(user: AuthUser, date: string, ctx: RequestContext): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.holiday.findUnique({
        where: { date: new Date(`${date}T00:00:00Z`) },
      });
      if (!existing) throw new NotFoundException();
      await tx.holiday.delete({ where: { date: existing.date } });
      await this.audit.record(tx, {
        actor: actor(user),
        action: 'HOLIDAY_REMOVED',
        entityType: 'Holiday',
        entityId: date,
        before: { date, name: existing.name },
        ctx,
      });
    });
  }

  async listReasonCodes(kind?: ReasonCodeKind): Promise<ReasonCode[]> {
    const rows = await this.prisma.reasonCode.findMany({
      where: kind ? { kind } : {},
      orderBy: [{ kind: 'asc' }, { code: 'asc' }],
    });
    return rows.map(toReasonCode);
  }

  async createReasonCode(
    user: AuthUser,
    body: CreateReasonCodeRequest,
    ctx: RequestContext,
  ): Promise<ReasonCode> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.reasonCode.create({ data: body });
        await this.audit.record(tx, {
          actor: actor(user),
          action: 'REASON_CODE_CREATED',
          entityType: 'ReasonCode',
          entityId: created.id,
          after: body,
          ctx,
        });
        return created;
      });
      return toReasonCode(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'REASON_CODE_EXISTS',
          message: 'That code already exists for this kind',
        });
      }
      throw err;
    }
  }

  async updateReasonCode(
    user: AuthUser,
    id: string,
    body: UpdateReasonCodeRequest,
    ctx: RequestContext,
  ): Promise<ReasonCode> {
    const row = await this.prisma.$transaction(async (tx) => {
      const before = await tx.reasonCode.findUnique({ where: { id } });
      if (!before) throw new NotFoundException();
      const updated = await tx.reasonCode.update({ where: { id }, data: body });
      await this.audit.record(tx, {
        actor: actor(user),
        action: 'REASON_CODE_UPDATED',
        entityType: 'ReasonCode',
        entityId: id,
        before: { label: before.label, active: before.active },
        after: { label: updated.label, active: updated.active },
        ctx,
      });
      return updated;
    });
    return toReasonCode(row);
  }
}
