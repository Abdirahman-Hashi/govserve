import { describe, expect, it } from 'vitest';
import {
  checkFormDefinition,
  conditionalFields,
  type FormSchema,
  isFieldActive,
  listPiiFields,
  type UiSchema,
  validateFormData,
} from './forms.js';

const schema: FormSchema = {
  type: 'object',
  properties: {
    fullName: { type: 'string', title: 'Full name', minLength: 2, maxLength: 120 },
    idNumber: {
      type: 'string',
      title: 'ID number',
      pattern: '^[A-Z0-9]{5,20}$',
      'x-patternMessage': 'Use 5–20 letters and digits',
      'x-pii': true,
    },
    dateOfBirth: { type: 'string', title: 'Date of birth', format: 'date', 'x-pii': true },
    purpose: { type: 'string', title: 'Purpose', enum: ['EMPLOYMENT', 'TRAVEL', 'VISA', 'OTHER'] },
    destinationCountry: { type: 'string', title: 'Destination country', maxLength: 60 },
    yearsAtAddress: { type: 'integer', title: 'Years at address', minimum: 0, maximum: 120 },
    ownsHome: { type: 'boolean', title: 'Do you own the home?' },
  },
  required: ['fullName', 'idNumber', 'dateOfBirth', 'purpose'],
  allOf: [
    {
      if: { properties: { purpose: { const: 'TRAVEL' } }, required: ['purpose'] },
      then: { required: ['destinationCountry'] },
    },
  ],
};
const ui: UiSchema = {
  order: [
    'fullName',
    'idNumber',
    'dateOfBirth',
    'purpose',
    'destinationCountry',
    'yearsAtAddress',
    'ownsHome',
  ],
};
const valid = {
  fullName: 'Amina Hassan',
  idNumber: 'SO1234567',
  dateOfBirth: '1990-04-12',
  purpose: 'EMPLOYMENT',
};

describe('validateFormData', () => {
  it('should accept valid data and trim strings', () => {
    const r = validateFormData(schema, {
      ...valid,
      fullName: '  Amina Hassan  ',
      yearsAtAddress: 3,
      ownsHome: false,
    });
    expect(r).toEqual({ ok: true, data: { ...valid, yearsAtAddress: 3, ownsHome: false } });
  });

  it('should report one plain-English message per missing required field', () => {
    const r = validateFormData(schema, { fullName: '   ' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual({
      fullName: 'Enter full name',
      idNumber: 'Enter id number',
      dateOfBirth: 'Enter date of birth',
      purpose: 'Choose purpose',
    });
  });

  it('should use the custom pattern message and check formats, enums and ranges', () => {
    const r = validateFormData(schema, {
      ...valid,
      idNumber: 'bad id',
      dateOfBirth: '1990-13-40',
      purpose: 'HOLIDAY',
      yearsAtAddress: 200,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual({
      idNumber: 'Use 5–20 letters and digits',
      dateOfBirth: 'Use the format YYYY-MM-DD',
      purpose: 'Choose one of the options',
      yearsAtAddress: 'Enter 120 or less',
    });
  });

  it('should require the destination only when the purpose is travel', () => {
    const travel = validateFormData(schema, { ...valid, purpose: 'TRAVEL' });
    expect(travel.ok).toBe(false);
    if (!travel.ok)
      expect(travel.errors).toEqual({ destinationCountry: 'Enter destination country' });
    expect(
      validateFormData(schema, { ...valid, purpose: 'TRAVEL', destinationCountry: 'Kenya' }).ok,
    ).toBe(true);
  });

  it('should drop the destination when the purpose is not travel', () => {
    const r = validateFormData(schema, { ...valid, destinationCountry: 'Kenya' });
    expect(r).toEqual({ ok: true, data: valid });
  });

  it('should reject fields that are not part of the form', () => {
    const r = validateFormData(schema, { ...valid, role: 'ADMIN' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual({ role: 'This field is not part of the form' });
  });

  it('should reject a string where a number is expected', () => {
    const r = validateFormData(schema, { ...valid, yearsAtAddress: 'three' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors['yearsAtAddress']).toBe('Enter a number');
  });
});

describe('form definition helpers', () => {
  it('should list PII fields and conditional fields', () => {
    expect(listPiiFields(schema)).toEqual(['idNumber', 'dateOfBirth']);
    expect(conditionalFields(schema).get('destinationCountry')).toEqual({
      field: 'purpose',
      equals: 'TRAVEL',
    });
    expect(isFieldActive(schema, 'destinationCountry', { purpose: 'TRAVEL' })).toBe(true);
    expect(isFieldActive(schema, 'destinationCountry', { purpose: 'VISA' })).toBe(false);
  });
});

describe('checkFormDefinition', () => {
  it('should accept a consistent definition', () => {
    expect(checkFormDefinition(schema, ui).ok).toBe(true);
  });

  it.each([
    [
      'unsupported keyword',
      {
        ...schema,
        properties: { ...schema.properties, x: { type: 'string', title: 'X', oneOf: [] } },
      },
      ui,
    ],
    ['required field missing', { ...schema, required: ['nope'] }, ui],
    ['field missing from order', schema, { order: ui.order.slice(1) }],
    [
      'bad regex',
      {
        ...schema,
        properties: {
          ...schema.properties,
          idNumber: { type: 'string', title: 'ID', pattern: '([' },
        },
      },
      ui,
    ],
    [
      'condition on a non-option field',
      {
        ...schema,
        allOf: [
          {
            if: { properties: { fullName: { const: 'A' } }, required: ['fullName'] },
            then: { required: ['destinationCountry'] },
          },
        ],
      },
      ui,
    ],
    [
      'bad field name',
      { ...schema, properties: { 'Full Name': { type: 'string', title: 'X' } }, required: [] },
      { order: ['Full Name'] },
    ],
    ['empty form', { type: 'object', properties: {}, required: [] }, { order: [] }],
  ])('should reject a definition with %s', (_label, s, u) => {
    const r = checkFormDefinition(s, u);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.length).toBeGreaterThan(0);
  });
});
