import { type FormSchema, type RequiredDocument, type UiSchema } from '@govserve/shared';

/**
 * Pilot services from docs/SERVICES.md. Fees are TEST placeholders (feeIsTest = true)
 * until the owner confirms official amounts (open item O-1). Districts are free text
 * because the official district list is not confirmed; ID numbers use a generic pattern
 * for the same reason.
 */

const ID_NUMBER = {
  type: 'string',
  title: 'ID or passport number',
  pattern: '^[A-Za-z0-9-]{5,20}$',
  'x-patternMessage': 'Use 5–20 letters, digits or dashes',
  'x-pii': true,
} as const;
const PHONE = {
  type: 'string',
  title: 'Phone number',
  description: 'Include the country code, e.g. +252 61 234 5678',
  pattern: '^\\+?[0-9 -]{7,20}$',
  'x-patternMessage': 'Enter a valid phone number, e.g. +252 61 234 5678',
  'x-pii': true,
} as const;
const DATE_OF_BIRTH = {
  type: 'string',
  title: 'Date of birth',
  format: 'date',
  'x-pii': true,
} as const;
const FULL_NAME = { type: 'string', title: 'Full name', minLength: 2, maxLength: 120 } as const;
const PDF_OR_IMAGE = ['application/pdf', 'image/jpeg', 'image/png'] as RequiredDocument['mime'];
const FIVE_MB = 5 * 1024 * 1024;
const ID_DOCUMENT: RequiredDocument = {
  type: 'NATIONAL_ID_OR_PASSPORT',
  label: 'National ID card or passport',
  description: 'A clear photo or scan of the page with your photo and ID number.',
  mime: PDF_OR_IMAGE,
  maxBytes: FIVE_MB,
  required: true,
};

export interface SeedService {
  code: string;
  name: string;
  description: string;
  departmentCode: 'ADDRESS' | 'POLICE' | 'CIVIL_REGISTRY';
  slaWorkingDays: number;
  inPersonStep: 'NONE' | 'FINGERPRINTS' | 'APPEARANCE';
  approvalMode: 'SINGLE' | 'SUPERVISOR_SECOND' | 'SUPERVISOR_ON_RECORD_FOUND';
  validityMonths: number | null;
  certificatePrefix: string;
  subjectMode: 'SELF' | 'SELF_OR_CHILD';
  formSchema: FormSchema;
  uiSchema: UiSchema;
  requiredDocuments: RequiredDocument[];
  feeBaseCents: bigint;
  feePerCopyCents: bigint;
}

const proofOfAddress: SeedService = {
  code: 'PROOF_OF_ADDRESS',
  name: 'Proof of address',
  description:
    'A residence certificate from the Banadir Regional Administration confirming where you live. Needed for bank accounts, jobs, school enrolment and SIM registration.',
  departmentCode: 'ADDRESS',
  slaWorkingDays: 5,
  inPersonStep: 'NONE',
  approvalMode: 'SINGLE',
  validityMonths: 6,
  certificatePrefix: 'ADR',
  subjectMode: 'SELF',
  formSchema: {
    type: 'object',
    properties: {
      fullName: FULL_NAME,
      dateOfBirth: DATE_OF_BIRTH,
      idNumber: ID_NUMBER,
      phone: PHONE,
      email: { type: 'string', title: 'Email address', format: 'email', maxLength: 254 },
      district: { type: 'string', title: 'District', minLength: 2, maxLength: 60 },
      neighbourhood: {
        type: 'string',
        title: 'Neighbourhood (xaafad) or village',
        minLength: 2,
        maxLength: 80,
      },
      streetOrLandmark: {
        type: 'string',
        title: 'Street or landmark',
        description: 'Describe how to find your home, e.g. the street name or a nearby landmark.',
        minLength: 5,
        maxLength: 300,
        'x-widget': 'textarea',
      },
      houseNumber: { type: 'string', title: 'House number (if any)', maxLength: 20 },
      yearsAtAddress: { type: 'integer', title: 'Years at this address', minimum: 0, maximum: 100 },
      tenure: {
        type: 'string',
        title: 'Do you own or rent this home?',
        enum: ['OWN', 'RENT'],
        'x-enumLabels': ['I own it', 'I rent it'],
        'x-widget': 'radio',
      },
    },
    required: [
      'fullName',
      'dateOfBirth',
      'idNumber',
      'phone',
      'email',
      'district',
      'neighbourhood',
      'streetOrLandmark',
      'yearsAtAddress',
      'tenure',
    ],
  },
  uiSchema: {
    order: [
      'fullName',
      'dateOfBirth',
      'idNumber',
      'phone',
      'email',
      'district',
      'neighbourhood',
      'streetOrLandmark',
      'houseNumber',
      'yearsAtAddress',
      'tenure',
    ],
    sections: { fullName: 'About you', district: 'Your address' },
  },
  requiredDocuments: [
    ID_DOCUMENT,
    ...(
      [
        ['LEADER_LETTER', 'Letter from your neighbourhood (xaafad) leader'],
        ['RENTAL_AGREEMENT', 'Rental agreement'],
        ['UTILITY_BILL', 'Utility bill'],
        ['PROPERTY_DOCUMENT', 'Property document'],
      ] as const
    ).map(([type, label]): RequiredDocument => ({
      type,
      label,
      description: 'Any one proof that names you and this address.',
      mime: PDF_OR_IMAGE,
      maxBytes: FIVE_MB,
      required: true,
      oneOfGroup: 'ADDRESS_PROOF',
    })),
  ],
  feeBaseCents: 1000n,
  feePerCopyCents: 200n,
};

const policeClearance: SeedService = {
  code: 'POLICE_CLEARANCE',
  name: 'Police clearance (criminal record certificate)',
  description:
    'A certificate from the Criminal Investigation Department stating whether you have a criminal record. Needed for jobs, travel, visas and study abroad. Fingerprints are taken in person.',
  departmentCode: 'POLICE',
  slaWorkingDays: 10,
  inPersonStep: 'FINGERPRINTS',
  approvalMode: 'SUPERVISOR_ON_RECORD_FOUND',
  validityMonths: 6,
  certificatePrefix: 'POL',
  subjectMode: 'SELF',
  formSchema: {
    type: 'object',
    properties: {
      fullName: FULL_NAME,
      otherNames: { type: 'string', title: 'Other names you have used', maxLength: 200 },
      dateOfBirth: DATE_OF_BIRTH,
      placeOfBirth: { type: 'string', title: 'Place of birth', minLength: 2, maxLength: 120 },
      idNumber: ID_NUMBER,
      mothersFullName: {
        type: 'string',
        title: "Mother's full name",
        minLength: 2,
        maxLength: 120,
        'x-pii': true,
      },
      currentAddress: {
        type: 'string',
        title: 'Current address',
        minLength: 5,
        maxLength: 300,
        'x-widget': 'textarea',
      },
      purpose: {
        type: 'string',
        title: 'Purpose of the certificate',
        enum: ['EMPLOYMENT', 'TRAVEL', 'VISA', 'OTHER'],
        'x-enumLabels': ['Employment', 'Travel', 'Visa', 'Other'],
        'x-widget': 'radio',
      },
      destinationCountry: {
        type: 'string',
        title: 'Destination country',
        minLength: 2,
        maxLength: 60,
      },
    },
    required: [
      'fullName',
      'dateOfBirth',
      'placeOfBirth',
      'idNumber',
      'mothersFullName',
      'currentAddress',
      'purpose',
    ],
    allOf: [
      {
        if: { properties: { purpose: { const: 'TRAVEL' } }, required: ['purpose'] },
        then: { required: ['destinationCountry'] },
      },
    ],
  },
  uiSchema: {
    order: [
      'fullName',
      'otherNames',
      'dateOfBirth',
      'placeOfBirth',
      'idNumber',
      'mothersFullName',
      'currentAddress',
      'purpose',
      'destinationCountry',
    ],
  },
  requiredDocuments: [
    ID_DOCUMENT,
    {
      type: 'PASSPORT_PHOTO',
      label: 'Passport-size photo',
      description: 'A recent photo of your face on a plain background.',
      mime: ['image/jpeg', 'image/png'],
      maxBytes: FIVE_MB,
      required: true,
    },
  ],
  feeBaseCents: 1500n,
  feePerCopyCents: 200n,
};

const birthCertificate: SeedService = {
  code: 'BIRTH_CERTIFICATE',
  name: 'Birth certificate (late registration)',
  description:
    'Register a birth that was never registered and receive a birth certificate. You can apply for yourself or for your child. Parents must appear in person at the Civil Registry.',
  departmentCode: 'CIVIL_REGISTRY',
  slaWorkingDays: 15,
  inPersonStep: 'APPEARANCE',
  approvalMode: 'SUPERVISOR_SECOND',
  validityMonths: null,
  certificatePrefix: 'BRT',
  subjectMode: 'SELF_OR_CHILD',
  formSchema: {
    type: 'object',
    properties: {
      relationship: {
        type: 'string',
        title: 'Who is this birth certificate for?',
        enum: ['SELF', 'MOTHER', 'FATHER', 'GUARDIAN'],
        'x-enumLabels': [
          'Myself',
          'My child (I am the mother)',
          'My child (I am the father)',
          'A child in my care (I am the guardian)',
        ],
        'x-widget': 'radio',
      },
      subjectFullName: {
        type: 'string',
        title: 'Full name of the person being registered',
        minLength: 2,
        maxLength: 120,
      },
      sex: {
        type: 'string',
        title: 'Sex',
        enum: ['FEMALE', 'MALE'],
        'x-enumLabels': ['Female', 'Male'],
        'x-widget': 'radio',
      },
      dateOfBirth: DATE_OF_BIRTH,
      birthDistrict: { type: 'string', title: 'District of birth', minLength: 2, maxLength: 60 },
      placeOfBirthType: {
        type: 'string',
        title: 'Where was the birth?',
        enum: ['HOSPITAL', 'HOME'],
        'x-enumLabels': ['At a hospital or clinic', 'At home'],
        'x-widget': 'radio',
      },
      hospitalName: {
        type: 'string',
        title: 'Hospital or clinic name',
        minLength: 2,
        maxLength: 120,
      },
      fatherFullName: { type: 'string', title: "Father's full name", minLength: 2, maxLength: 120 },
      fatherIdNumber: { ...ID_NUMBER, title: "Father's ID number (if available)" },
      motherFullName: {
        type: 'string',
        title: "Mother's full name",
        minLength: 2,
        maxLength: 120,
        'x-pii': true,
      },
      motherIdNumber: { ...ID_NUMBER, title: "Mother's ID number (if available)" },
    },
    required: [
      'relationship',
      'subjectFullName',
      'sex',
      'dateOfBirth',
      'birthDistrict',
      'placeOfBirthType',
      'fatherFullName',
      'motherFullName',
    ],
    allOf: [
      {
        if: {
          properties: { placeOfBirthType: { const: 'HOSPITAL' } },
          required: ['placeOfBirthType'],
        },
        then: { required: ['hospitalName'] },
      },
    ],
  },
  uiSchema: {
    order: [
      'relationship',
      'subjectFullName',
      'sex',
      'dateOfBirth',
      'birthDistrict',
      'placeOfBirthType',
      'hospitalName',
      'fatherFullName',
      'fatherIdNumber',
      'motherFullName',
      'motherIdNumber',
    ],
    sections: { relationship: 'The person being registered', fatherFullName: 'Parents' },
  },
  requiredDocuments: [
    { ...ID_DOCUMENT, type: 'APPLICANT_ID', label: 'Your national ID card or passport' },
    {
      type: 'FATHER_ID',
      label: "Father's ID (if available)",
      mime: PDF_OR_IMAGE,
      maxBytes: FIVE_MB,
      required: false,
    },
    {
      type: 'MOTHER_ID',
      label: "Mother's ID (if available)",
      mime: PDF_OR_IMAGE,
      maxBytes: FIVE_MB,
      required: false,
    },
    {
      type: 'BIRTH_NOTIFICATION',
      label: 'Hospital birth notification (if any)',
      mime: PDF_OR_IMAGE,
      maxBytes: FIVE_MB,
      required: false,
    },
    {
      type: 'LEADER_LETTER',
      label: 'Letter from the neighbourhood (xaafad) leader (home births)',
      mime: PDF_OR_IMAGE,
      maxBytes: FIVE_MB,
      required: false,
    },
  ],
  feeBaseCents: 2000n,
  feePerCopyCents: 200n,
};

export const PILOT_SERVICES: SeedService[] = [proofOfAddress, policeClearance, birthCertificate];

export const DEFAULT_REASON_CODES: {
  kind: 'REJECT' | 'PAYMENT_REJECT' | 'REVOKE' | 'REFUND_DECLINE';
  code: string;
  label: string;
}[] = [
  {
    kind: 'REJECT',
    code: 'DOCUMENTS_INVALID',
    label: 'Documents are missing, unreadable or invalid',
  },
  {
    kind: 'REJECT',
    code: 'IDENTITY_MISMATCH',
    label: 'Identity details do not match the documents',
  },
  { kind: 'REJECT', code: 'NOT_ELIGIBLE', label: 'Applicant is not eligible for this service' },
  {
    kind: 'REJECT',
    code: 'DUPLICATE_APPLICATION',
    label: 'A record or application already exists',
  },
  { kind: 'REJECT', code: 'NO_SHOW', label: 'Did not attend the in-person appointment' },
  { kind: 'REJECT', code: 'OTHER', label: 'Other (explained in the note)' },
  {
    kind: 'PAYMENT_REJECT',
    code: 'REFERENCE_NOT_FOUND',
    label: 'Transaction or slip reference not found',
  },
  { kind: 'PAYMENT_REJECT', code: 'AMOUNT_MISMATCH', label: 'Amount received does not match' },
  { kind: 'PAYMENT_REJECT', code: 'EVIDENCE_UNREADABLE', label: 'Payment evidence is unreadable' },
  { kind: 'PAYMENT_REJECT', code: 'OTHER', label: 'Other (explained in the note)' },
  { kind: 'REVOKE', code: 'FRAUD', label: 'Issued on fraudulent information' },
  { kind: 'REVOKE', code: 'ERROR', label: 'Issued in error' },
  { kind: 'REVOKE', code: 'CHARGEBACK', label: 'Payment was reversed' },
  { kind: 'REFUND_DECLINE', code: 'NOT_ELIGIBLE', label: 'Not eligible for a refund' },
  { kind: 'REFUND_DECLINE', code: 'OTHER', label: 'Other (explained in the note)' },
];
