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

  const settings = await prisma.setting.createMany({
    data: SETTING_KEYS.map((key) => ({ key, value: SETTING_DEFAULTS[key] })),
    skipDuplicates: true,
  });
  const reasons = await prisma.reasonCode.createMany({
    data: DEFAULT_REASON_CODES,
    skipDuplicates: true,
  });
  return { servicesCreated, settingsCreated: settings.count, reasonCodesCreated: reasons.count };
}
