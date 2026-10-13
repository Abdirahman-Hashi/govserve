import { type CatalogueServiceDetail, type ServiceVersion } from '@govserve/shared';

export const policeDetail: CatalogueServiceDetail = {
  code: 'POLICE_CLEARANCE',
  name: 'Police clearance (criminal record certificate)',
  description:
    'A certificate from the Criminal Investigation Department stating whether you have a criminal record.',
  departmentCode: 'POLICE',
  slaWorkingDays: 10,
  fee: { baseCents: '1500', perCopyCents: '200' },
  feeProvisional: true,
  versionId: '0199e0a8-7c1b-7d2e-9f00-1a2b3c4d5e6f',
  versionNo: 1,
  inPersonStep: 'FINGERPRINTS',
  subjectMode: 'SELF',
  validityMonths: 6,
  formSchema: {
    type: 'object',
    properties: {
      fullName: { type: 'string', title: 'Full name', minLength: 2 },
      purpose: {
        type: 'string',
        title: 'Purpose of the certificate',
        enum: ['EMPLOYMENT', 'TRAVEL'],
        'x-enumLabels': ['Employment', 'Travel'],
        'x-widget': 'radio',
      },
      destinationCountry: { type: 'string', title: 'Destination country', minLength: 2 },
    },
    required: ['fullName', 'purpose'],
    allOf: [
      {
        if: { properties: { purpose: { const: 'TRAVEL' } }, required: ['purpose'] },
        then: { required: ['destinationCountry'] },
      },
    ],
  },
  uiSchema: { order: ['fullName', 'purpose', 'destinationCountry'] },
  requiredDocuments: [
    {
      type: 'NATIONAL_ID_OR_PASSPORT',
      label: 'National ID card or passport',
      mime: ['application/pdf', 'image/jpeg'],
      maxBytes: 5242880,
      required: true,
    },
    {
      type: 'LEADER_LETTER',
      label: 'Leader letter',
      mime: ['application/pdf'],
      maxBytes: 5242880,
      required: true,
      oneOfGroup: 'PROOF',
    },
    {
      type: 'UTILITY_BILL',
      label: 'Utility bill',
      mime: ['application/pdf'],
      maxBytes: 5242880,
      required: true,
      oneOfGroup: 'PROOF',
    },
  ],
};

export function versionFrom(
  detail: CatalogueServiceDetail,
  overrides: Partial<ServiceVersion> = {},
): ServiceVersion {
  return {
    id: '0199e0a8-7c1b-7d2e-9f00-000000000002',
    serviceId: '0199e0a8-7c1b-7d2e-9f00-000000000001',
    versionNo: 2,
    status: 'DRAFT',
    formSchema: detail.formSchema,
    uiSchema: detail.uiSchema,
    requiredDocuments: detail.requiredDocuments,
    fee: detail.fee,
    feeIsTest: true,
    publishedAt: null,
    createdAt: '2026-10-13T12:00:00.000Z',
    ...overrides,
  };
}
