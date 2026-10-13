import { checkFormDefinition, listPiiFields, validateFormData } from '@govserve/shared';
import { validateForPublish } from './catalogue.service';
import { PILOT_SERVICES } from './seed-data';

const byCode = Object.fromEntries(PILOT_SERVICES.map((s) => [s.code, s]));

describe('pilot services (docs/SERVICES.md)', () => {
  it.each(PILOT_SERVICES.map((s) => [s.code, s] as const))(
    'should pass the publish gate for %s',
    (_code, svc) => {
      expect(validateForPublish(svc)).toEqual([]);
    },
  );

  it('should match the confirmed department, in-person step, approval mode and validity', () => {
    expect(
      PILOT_SERVICES.map((s) => [
        s.code,
        s.departmentCode,
        s.inPersonStep,
        s.approvalMode,
        s.validityMonths,
        s.subjectMode,
      ]),
    ).toEqual([
      ['PROOF_OF_ADDRESS', 'ADDRESS', 'NONE', 'SINGLE', 6, 'SELF'],
      ['POLICE_CLEARANCE', 'POLICE', 'FINGERPRINTS', 'SUPERVISOR_ON_RECORD_FOUND', 6, 'SELF'],
      [
        'BIRTH_CERTIFICATE',
        'CIVIL_REGISTRY',
        'APPEARANCE',
        'SUPERVISOR_SECOND',
        null,
        'SELF_OR_CHILD',
      ],
    ]);
  });

  it('should use the TEST fee placeholders in exact cents', () => {
    expect(PILOT_SERVICES.map((s) => [s.code, s.feeBaseCents, s.feePerCopyCents])).toEqual([
      ['PROOF_OF_ADDRESS', 1000n, 200n],
      ['POLICE_CLEARANCE', 1500n, 200n],
      ['BIRTH_CERTIFICATE', 2000n, 200n],
    ]);
  });

  it('should accept any one address proof (one-of group) for proof of address', () => {
    const docs = byCode['PROOF_OF_ADDRESS']!.requiredDocuments;
    expect(docs.filter((d) => d.oneOfGroup === 'ADDRESS_PROOF').map((d) => d.type)).toEqual([
      'LEADER_LETTER',
      'RENTAL_AGREEMENT',
      'UTILITY_BILL',
      'PROPERTY_DOCUMENT',
    ]);
  });

  it('should mark the decided PII fields for encryption (NFR-002)', () => {
    const pii = (code: string) => {
      const check = checkFormDefinition(byCode[code]!.formSchema, byCode[code]!.uiSchema);
      return check.ok ? listPiiFields(check.schema) : [];
    };
    expect(pii('PROOF_OF_ADDRESS')).toEqual(['dateOfBirth', 'idNumber', 'phone']);
    expect(pii('POLICE_CLEARANCE')).toEqual(['dateOfBirth', 'idNumber', 'mothersFullName']);
    expect(pii('BIRTH_CERTIFICATE')).toEqual([
      'dateOfBirth',
      'fatherIdNumber',
      'motherFullName',
      'motherIdNumber',
    ]);
  });

  it('should require a hospital name only for hospital births', () => {
    const svc = byCode['BIRTH_CERTIFICATE']!;
    const base = {
      relationship: 'MOTHER',
      subjectFullName: 'Hodan Ali',
      sex: 'FEMALE',
      dateOfBirth: '2019-05-01',
      birthDistrict: 'Hodan',
      fatherFullName: 'Ali Warsame',
      motherFullName: 'Amina Hassan',
    };
    expect(validateFormData(svc.formSchema, { ...base, placeOfBirthType: 'HOME' }).ok).toBe(true);
    const hospital = validateFormData(svc.formSchema, { ...base, placeOfBirthType: 'HOSPITAL' });
    expect(hospital.ok ? {} : hospital.errors).toEqual({
      hospitalName: 'Enter hospital or clinic name',
    });
  });
});

describe('validateForPublish', () => {
  const ok = byCode['PROOF_OF_ADDRESS']!;

  it('should reject a negative fee', () => {
    expect(validateForPublish({ ...ok, feeBaseCents: -1n })).toContain('Fees must not be negative');
  });

  it('should reject documents with duplicate types', () => {
    const doc = ok.requiredDocuments[0]!;
    expect(validateForPublish({ ...ok, requiredDocuments: [doc, doc] }).join()).toMatch(/unique/);
  });

  it('should reject a form outside the supported subset', () => {
    expect(validateForPublish({ ...ok, formSchema: { type: 'array' } }).length).toBeGreaterThan(0);
  });
});
