import { addWorkingDays } from '../common/working-days';
import { type ConfigAdminService } from '../config-admin/config-admin.service';
import { type Application, type Prisma } from '../generated/prisma/client';

/** SLA pauses during corrections and appointments (FR-080). */
export function pause(
  app: Pick<Application, 'slaPausedAt'>,
  now: Date,
): Prisma.ApplicationUncheckedUpdateManyInput {
  return app.slaPausedAt ? {} : { slaPausedAt: now };
}

/** On resume, the due date moves later by the paused time. */
export function resume(
  app: Pick<Application, 'slaPausedAt' | 'slaDueAt' | 'slaPausedTotalMs'>,
  now: Date,
): Prisma.ApplicationUncheckedUpdateManyInput {
  if (!app.slaPausedAt) return {};
  const delta = BigInt(Math.max(0, now.getTime() - app.slaPausedAt.getTime()));
  return {
    slaPausedAt: null,
    slaPausedTotalMs: app.slaPausedTotalMs + delta,
    ...(app.slaDueAt && { slaDueAt: new Date(app.slaDueAt.getTime() + Number(delta)) }),
  };
}

/** A decision ends the SLA clock. */
export function stopSla(
  app: Pick<Application, 'slaPausedAt'>,
): Prisma.ApplicationUncheckedUpdateManyInput {
  return app.slaPausedAt ? { slaPausedAt: null } : {};
}

/** FR-071: a claim lapses after N working days without activity. */
export async function claimExpiry(
  tx: Prisma.TransactionClient,
  settings: ConfigAdminService,
  now = new Date(),
): Promise<Date> {
  const [days, week, holidays] = await Promise.all([
    settings.get('claim.expiryWorkingDays'),
    settings.get('calendar.workingWeek'),
    tx.holiday.findMany({ select: { date: true } }),
  ]);
  return addWorkingDays(
    now,
    days,
    week,
    new Set(holidays.map((h) => h.date.toISOString().slice(0, 10))),
  );
}
