import {
  type AdminService,
  type CatalogueServiceDetail,
  type CatalogueServiceSummary,
  type DepartmentCode,
  type FormSchema,
  type RequiredDocument,
  type ServiceVersion as ServiceVersionDto,
  type UiSchema,
} from '@govserve/shared';
import { type Department, type Service, type ServiceVersion } from '../generated/prisma/client';

export type ServiceWithRelations = Service & { department: Department; versions: ServiceVersion[] };

const fee = (v: ServiceVersion) => ({
  baseCents: v.feeBaseCents.toString(),
  perCopyCents: v.feePerCopyCents.toString(),
});

export function published(service: ServiceWithRelations): ServiceVersion | undefined {
  return service.versions.find((v) => v.status === 'PUBLISHED');
}

export function toSummary(
  service: ServiceWithRelations,
  version: ServiceVersion,
): CatalogueServiceSummary {
  return {
    code: service.code,
    name: service.name,
    description: service.description,
    departmentCode: service.department.code as DepartmentCode,
    slaWorkingDays: service.slaWorkingDays,
    fee: fee(version),
    feeProvisional: version.feeIsTest,
  };
}

export function toDetail(
  service: ServiceWithRelations,
  version: ServiceVersion,
): CatalogueServiceDetail {
  return {
    ...toSummary(service, version),
    versionId: version.id,
    versionNo: version.versionNo,
    inPersonStep: service.inPersonStep,
    subjectMode: service.subjectMode,
    validityMonths: service.validityMonths,
    // Published versions were checked at publish time.
    formSchema: version.formSchema as unknown as FormSchema,
    uiSchema: version.uiSchema as unknown as UiSchema,
    requiredDocuments: version.requiredDocuments as unknown as RequiredDocument[],
  };
}

export function toAdminService(service: ServiceWithRelations): AdminService {
  const live = published(service);
  return {
    id: service.id,
    code: service.code,
    departmentCode: service.department.code as DepartmentCode,
    certificatePrefix: service.certificatePrefix,
    name: service.name,
    description: service.description,
    active: service.active,
    slaWorkingDays: service.slaWorkingDays,
    inPersonStep: service.inPersonStep,
    approvalMode: service.approvalMode,
    validityMonths: service.validityMonths,
    subjectMode: service.subjectMode,
    publishedVersionNo: live?.versionNo ?? null,
    draftVersionId: service.versions.find((v) => v.status === 'DRAFT')?.id ?? null,
    feeIsTest: live?.feeIsTest ?? null,
  };
}

export function toVersionDto(v: ServiceVersion): ServiceVersionDto {
  return {
    id: v.id,
    serviceId: v.serviceId,
    versionNo: v.versionNo,
    status: v.status,
    formSchema: v.formSchema as Record<string, unknown>,
    uiSchema: v.uiSchema as Record<string, unknown>,
    requiredDocuments: v.requiredDocuments as unknown as RequiredDocument[],
    fee: fee(v),
    feeIsTest: v.feeIsTest,
    publishedAt: v.publishedAt?.toISOString() ?? null,
    createdAt: v.createdAt.toISOString(),
  };
}
