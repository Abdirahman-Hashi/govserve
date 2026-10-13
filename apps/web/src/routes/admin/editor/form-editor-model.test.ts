import {
  checkFormDefinition,
  type FormSchema,
  type UiSchema,
  validateFormData,
} from '@govserve/shared';
import { describe, expect, it } from 'vitest';
import {
  type EditorField,
  fromDefinition,
  move,
  newField,
  toDefinition,
} from './form-editor-model';

const schema: FormSchema = {
  type: 'object',
  properties: {
    fullName: { type: 'string', title: 'Full name', minLength: 2, maxLength: 120 },
    idNumber: {
      type: 'string',
      title: 'ID number',
      pattern: '^[A-Z0-9]{5,20}$',
      'x-patternMessage': 'Use 5–20 letters',
      'x-pii': true,
    },
    dateOfBirth: { type: 'string', title: 'Date of birth', format: 'date', 'x-pii': true },
    notes: { type: 'string', title: 'Notes', description: 'Anything else', 'x-widget': 'textarea' },
    years: { type: 'integer', title: 'Years', minimum: 0, maximum: 100 },
    owns: { type: 'boolean', title: 'Owner?' },
    purpose: {
      type: 'string',
      title: 'Purpose',
      enum: ['WORK', 'TRAVEL'],
      'x-enumLabels': ['Work', 'Travel'],
      'x-widget': 'radio',
    },
    country: { type: 'string', title: 'Country' },
  },
  required: ['fullName', 'idNumber', 'dateOfBirth', 'purpose'],
  allOf: [
    {
      if: { properties: { purpose: { const: 'TRAVEL' } }, required: ['purpose'] },
      then: { required: ['country'] },
    },
  ],
};
const ui: UiSchema = {
  order: ['fullName', 'idNumber', 'dateOfBirth', 'notes', 'years', 'owns', 'purpose', 'country'],
  sections: { fullName: 'About you' },
};

describe('form editor model', () => {
  it('should round-trip a definition through the field list unchanged', () => {
    expect(toDefinition(fromDefinition(schema, ui))).toEqual({ formSchema: schema, uiSchema: ui });
  });

  it('should produce a definition that passes the shared publish check', () => {
    const fields: EditorField[] = [
      {
        ...newField([]),
        name: 'reason',
        kind: 'select',
        title: 'Reason',
        options: [
          { value: 'A', label: 'Option A' },
          { value: 'B', label: '' },
        ],
      },
      {
        ...newField(['reason']),
        name: 'detail',
        title: 'Details',
        showWhen: { field: 'reason', equals: 'B' },
      },
    ];
    const { formSchema, uiSchema } = toDefinition(fields);
    expect(checkFormDefinition(formSchema, uiSchema).ok).toBe(true);
    // Unlabelled options fall back to their value.
    expect(formSchema.properties['reason']).toMatchObject({ 'x-enumLabels': ['Option A', 'B'] });
    // The conditional field is required only when shown.
    expect(validateFormData(formSchema, { reason: 'A' }).ok).toBe(true);
    expect(validateFormData(formSchema, { reason: 'B' }).ok).toBe(false);
  });

  it('should pick an unused name for a new field and reorder fields', () => {
    expect(newField(['field1', 'field2']).name).toBe('field3');
    expect(move(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(move(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });
});
