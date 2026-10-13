import { Validator, type OutputUnit } from '@cfworker/json-schema';
import { z } from 'zod';

/**
 * Service form definitions (FR-021): a deliberately small subset of JSON Schema 2020-12 that
 * the version editor can produce, the renderer can draw, and both the browser and the API
 * validate with the same code. Validation uses @cfworker/json-schema, which needs no
 * runtime code generation (so a strict CSP without 'unsafe-eval' still works).
 */

export const FIELD_NAME = /^[a-z][a-zA-Z0-9]{0,39}$/;

const base = {
  title: z.string().trim().min(1).max(120),
  description: z.string().max(300).optional(),
  /** Stored encrypted when the application is saved (NFR-002). */
  'x-pii': z.boolean().optional(),
};

const StringField = z.strictObject({
  ...base,
  type: z.literal('string'),
  minLength: z.number().int().min(0).max(2000).optional(),
  maxLength: z.number().int().min(1).max(2000).optional(),
  pattern: z.string().max(200).optional(),
  'x-patternMessage': z.string().max(120).optional(),
  format: z.enum(['date', 'email']).optional(),
  enum: z.array(z.string().min(1).max(60)).min(1).max(50).optional(),
  'x-enumLabels': z.array(z.string().min(1).max(120)).optional(),
  'x-widget': z.enum(['textarea', 'radio']).optional(),
});

const NumberField = z.strictObject({
  ...base,
  type: z.enum(['integer', 'number']),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
});

const BooleanField = z.strictObject({ ...base, type: z.literal('boolean') });

export const FieldSchema = z.discriminatedUnion('type', [StringField, NumberField, BooleanField]);
export type FieldSchema = z.infer<typeof FieldSchema>;

/** "If <field> equals <value>, these fields become required (and visible)." */
export const ConditionSchema = z.strictObject({
  if: z.strictObject({
    properties: z.record(z.string(), z.strictObject({ const: z.string() })),
    required: z.array(z.string()).length(1),
  }),
  then: z.strictObject({ required: z.array(z.string()).min(1) }),
});
export type Condition = z.infer<typeof ConditionSchema>;

export const FormSchemaDefinition = z.strictObject({
  $schema: z.literal('https://json-schema.org/draft/2020-12/schema').optional(),
  type: z.literal('object'),
  properties: z.record(z.string(), FieldSchema),
  required: z.array(z.string()).default([]),
  allOf: z.array(ConditionSchema).optional(),
});
export type FormSchema = z.infer<typeof FormSchemaDefinition>;

export const UiSchemaDefinition = z.strictObject({
  /** Field display order; must list every field exactly once. */
  order: z.array(z.string()),
  /** Optional section headings: field name → heading shown before it. */
  sections: z.record(z.string(), z.string().max(80)).optional(),
});
export type UiSchema = z.infer<typeof UiSchemaDefinition>;

export type FormValue = string | number | boolean;
export type FormValues = Record<string, FormValue>;

export type FormCheck =
  { ok: true; schema: FormSchema; ui: UiSchema } | { ok: false; problems: string[] };

/**
 * Checks a form definition is inside the supported subset and internally consistent.
 * A version cannot be published unless this passes.
 */
export function checkFormDefinition(formSchema: unknown, uiSchema: unknown): FormCheck {
  const parsedSchema = FormSchemaDefinition.safeParse(formSchema);
  const parsedUi = UiSchemaDefinition.safeParse(uiSchema);
  const problems: string[] = [];
  if (!parsedSchema.success) {
    problems.push(
      ...parsedSchema.error.issues.map((i) => `formSchema.${i.path.join('.')}: ${i.message}`),
    );
  }
  if (!parsedUi.success) {
    problems.push(
      ...parsedUi.error.issues.map((i) => `uiSchema.${i.path.join('.')}: ${i.message}`),
    );
  }
  if (!parsedSchema.success || !parsedUi.success) return { ok: false, problems };

  const schema = parsedSchema.data;
  const ui = parsedUi.data;
  const names = Object.keys(schema.properties);
  if (names.length === 0) problems.push('The form needs at least one field');
  for (const name of names) {
    if (!FIELD_NAME.test(name))
      problems.push(`Field name "${name}" must be camelCase letters and digits`);
    const field = schema.properties[name]!;
    if (field.type === 'string') {
      if (field.pattern !== undefined && !isValidRegex(field.pattern))
        problems.push(`Field "${name}" has an invalid pattern`);
      if (
        field.minLength !== undefined &&
        field.maxLength !== undefined &&
        field.minLength > field.maxLength
      ) {
        problems.push(`Field "${name}": minLength is greater than maxLength`);
      }
      if (field['x-enumLabels'] && field['x-enumLabels'].length !== field.enum?.length) {
        problems.push(`Field "${name}": x-enumLabels must match enum one-to-one`);
      }
      if (field.enum && new Set(field.enum).size !== field.enum.length)
        problems.push(`Field "${name}": duplicate options`);
      if (field['x-widget'] === 'radio' && !field.enum)
        problems.push(`Field "${name}": radio needs options`);
    }
    if (
      field.type !== 'string' &&
      field.type !== 'boolean' &&
      field.minimum !== undefined &&
      field.maximum !== undefined &&
      field.minimum > field.maximum
    ) {
      problems.push(`Field "${name}": minimum is greater than maximum`);
    }
  }
  for (const r of schema.required)
    if (!names.includes(r)) problems.push(`Required field "${r}" does not exist`);
  for (const [i, cond] of (schema.allOf ?? []).entries()) {
    const [trigger] = cond.if.required;
    const expected = trigger ? cond.if.properties[trigger]?.const : undefined;
    const field = trigger ? schema.properties[trigger] : undefined;
    if (!trigger || expected === undefined || Object.keys(cond.if.properties).join() !== trigger) {
      problems.push(`Condition ${i + 1} must test exactly one field`);
    } else if (!field || field.type !== 'string' || !field.enum?.includes(expected)) {
      problems.push(
        `Condition ${i + 1}: "${trigger}" must be an options field with option "${expected}"`,
      );
    }
    for (const r of cond.then.required) {
      if (!names.includes(r)) problems.push(`Condition ${i + 1} requires unknown field "${r}"`);
      if (r === trigger) problems.push(`Condition ${i + 1} cannot require its own trigger field`);
    }
  }
  const order = ui.order;
  if (new Set(order).size !== order.length) problems.push('uiSchema.order lists a field twice');
  for (const n of names) if (!order.includes(n)) problems.push(`uiSchema.order is missing "${n}"`);
  for (const n of order)
    if (!names.includes(n)) problems.push(`uiSchema.order lists unknown field "${n}"`);
  for (const n of Object.keys(ui.sections ?? {}))
    if (!names.includes(n)) problems.push(`uiSchema.sections refers to unknown field "${n}"`);

  return problems.length ? { ok: false, problems } : { ok: true, schema, ui };
}

/** Fields that only apply when a condition holds, with the condition that shows them. */
export function conditionalFields(
  schema: FormSchema,
): Map<string, { field: string; equals: string }> {
  const out = new Map<string, { field: string; equals: string }>();
  for (const cond of schema.allOf ?? []) {
    const trigger = cond.if.required[0]!;
    const equals = cond.if.properties[trigger]!.const;
    for (const r of cond.then.required) out.set(r, { field: trigger, equals });
  }
  return out;
}

/** True when a field should be shown (and accepted) for the current values. */
export function isFieldActive(schema: FormSchema, name: string, values: FormValues): boolean {
  const rule = conditionalFields(schema).get(name);
  return !rule || values[rule.field] === rule.equals;
}

export function listPiiFields(schema: FormSchema): string[] {
  return Object.entries(schema.properties)
    .filter(([, f]) => f['x-pii'] === true)
    .map(([name]) => name);
}

export type FormValidation =
  { ok: true; data: FormValues } | { ok: false; errors: Record<string, string> };

/**
 * Validates submitted values (FR-033). Strings are trimmed and blank values treated as
 * absent; values of inactive conditional fields are dropped; unknown fields are rejected.
 * Returns cleaned data or one plain-English message per field.
 */
export function validateFormData(
  schema: FormSchema,
  input: Record<string, unknown>,
): FormValidation {
  const errors: Record<string, string> = {};
  const data: FormValues = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!(key in schema.properties)) {
      errors[key] = 'This field is not part of the form';
      continue;
    }
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (value === '' || value === null || value === undefined) continue;
    data[key] = value as FormValue;
  }
  for (const key of Object.keys(data)) if (!isFieldActive(schema, key, data)) delete data[key];

  const validator = new Validator(schema, '2020-12', false);
  const result = validator.validate(data);
  for (const unit of result.errors) {
    const field = fieldOf(unit);
    if (!field || errors[field]) continue;
    const message = messageFor(schema, field, unit);
    if (message) errors[field] = message;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data };
}

const CONTAINER_KEYWORDS = new Set([
  'allOf',
  'if',
  'then',
  'properties',
  'additionalProperties',
  '$ref',
]);

function fieldOf(unit: OutputUnit): string | undefined {
  if (unit.keyword === 'required') return /"([^"]+)"/.exec(unit.error)?.[1];
  if (CONTAINER_KEYWORDS.has(unit.keyword)) return undefined;
  const path = unit.instanceLocation.replace(/^#\/?/, '');
  return path ? decodeURIComponent(path.split('/')[0]!) : undefined;
}

function messageFor(schema: FormSchema, name: string, unit: OutputUnit): string | undefined {
  const field = schema.properties[name];
  if (!field) return undefined;
  const label = field.title.toLowerCase();
  switch (unit.keyword) {
    case 'required':
      return field.type === 'string' && field.enum ? `Choose ${label}` : `Enter ${label}`;
    case 'type':
      return field.type === 'boolean'
        ? 'Choose yes or no'
        : field.type === 'string'
          ? `Enter ${label}`
          : 'Enter a number';
    case 'minLength':
      return field.type === 'string' ? `Use at least ${field.minLength} characters` : undefined;
    case 'maxLength':
      return field.type === 'string' ? `Use at most ${field.maxLength} characters` : undefined;
    case 'pattern':
      return field.type === 'string'
        ? (field['x-patternMessage'] ?? `Enter a valid ${label}`)
        : undefined;
    case 'format':
      return field.type === 'string' && field.format === 'date'
        ? 'Use the format YYYY-MM-DD'
        : 'Enter a valid email address';
    case 'enum':
    case 'const':
      return 'Choose one of the options';
    case 'minimum':
      return field.type !== 'string' && field.type !== 'boolean'
        ? `Enter ${field.minimum} or more`
        : undefined;
    case 'maximum':
      return field.type !== 'string' && field.type !== 'boolean'
        ? `Enter ${field.maximum} or less`
        : undefined;
    default:
      return `Enter a valid ${label}`;
  }
}

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern, 'u');
    return true;
  } catch {
    return false;
  }
}
