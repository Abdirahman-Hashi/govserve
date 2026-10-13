import { checkFormDefinition, SETTING_DEFAULTS, SETTING_KEYS } from '@govserve/shared';
import { type PrismaClient } from '../generated/prisma/client';
import { DEFAULT_REASON_CODES, PILOT_SERVICES } from './seed-data';

export interface SeedResult {
  servicesCreated: string[];
  settingsCreated: number;
  reasonCodesCreated: number;
}

/**
 * Inserts missing reference data only; never overwrites what an admin has changed.
 * Safe to run on every deploy and in tests.
 */
export async function seedReferenceData(prisma: PrismaClient): Promise<SeedResult> {
  const servicesCreated: string[] = [];
  for (const svc of PILOT_SERVICES) {
    const check = checkFormDefinition(svc.formSchema, svc.uiSchema);
    if (!check.ok)
      throw new Error(`Seed form for ${svc.code} is invalid: ${check.problems.join('; ')}`);
    await prisma.$transaction(async (tx) => {
      if (await tx.service.findUnique({ where: { code: svc.code } })) return;
      const department = await tx.department.findUniqueOrThrow({
        where: { code: svc.departmentCode },
      });
      const service = await tx.service.create({
        data: {
          code: svc.code,
          name: svc.name,
          description: svc.description,
          departmentId: department.id,
          slaWorkingDays: svc.slaWorkingDays,
          inPersonStep: svc.inPersonStep,
          approvalMode: svc.approvalMode,
          validityMonths: svc.validityMonths,
          certificatePrefix: svc.certificatePrefix,
          subjectMode: svc.subjectMode,
          versions: {
            create: {
              versionNo: 1,
              status: 'PUBLISHED',
              publishedAt: new Date(),
              formSchema: svc.formSchema,
              uiSchema: svc.uiSchema,
              requiredDocuments: svc.requiredDocuments,
              feeBaseCents: svc.feeBaseCents,
              feePerCopyCents: svc.feePerCopyCents,
              feeIsTest: true,
            },
          },
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'SERVICE_CREATED',
          entityType: 'Service',
          entityId: service.id,
          departmentId: department.id,
          after: { code: svc.code, source: 'seed', versionNo: 1, feeIsTest: true },
        },
      });
      servicesCreated.push(svc.code);
    });
  }

  // Defaults that do not exist yet are created and audited (FR-130: settings are admin data).
  const { settingsCreated, reasonCodesCreated } = await prisma.$transaction(async (tx) => {
    const existing = new Set(
      (await tx.setting.findMany({ select: { key: true } })).map((r) => r.key),
    );
    const newSettings = SETTING_KEYS.filter((key) => !existing.has(key));
    for (const key of newSettings) {
      await tx.setting.create({ data: { key, value: SETTING_DEFAULTS[key] } });
      await tx.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'SETTING_DEFAULTED',
          entityType: 'Setting',
          entityId: key,
          after: { key, value: SETTING_DEFAULTS[key], source: 'seed' },
        },
      });
    }
    const codes = new Set(
      (await tx.reasonCode.findMany({ select: { kind: true, code: true } })).map(
        (r) => `${r.kind}:${r.code}`,
      ),
    );
    const newCodes = DEFAULT_REASON_CODES.filter((r) => !codes.has(`${r.kind}:${r.code}`));
    for (const r of newCodes) {
      const created = await tx.reasonCode.create({ data: r });
      await tx.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'REASON_CODE_CREATED',
          entityType: 'ReasonCode',
          entityId: created.id,
          after: { kind: r.kind, code: r.code, source: 'seed' },
        },
      });
    }
    return { settingsCreated: newSettings.length, reasonCodesCreated: newCodes.length };
  });
  return { servicesCreated, settingsCreated, reasonCodesCreated };
}
