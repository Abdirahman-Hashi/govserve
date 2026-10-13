import { type FieldSchema, type FormSchema, type UiSchema } from '@govserve/shared';

/** How a field looks in the version editor; converted to/from JSON Schema + uiSchema. */
export type EditorFieldKind =
  'text' | 'textarea' | 'email' | 'date' | 'integer' | 'number' | 'select' | 'radio' | 'yesno';

export interface EditorOption {
  value: string;
  label: string;
}

export interface EditorField {
  name: string;
  kind: EditorFieldKind;
  title: string;
  description: string;
  required: boolean;
  pii: boolean;
  minLength?: number | undefined;
  maxLength?: number | undefined;
  pattern?: string | undefined;
  patternMessage?: string | undefined;
  minimum?: number | undefined;
  maximum?: number | undefined;
  options: EditorOption[];
  /** Only shown (and then required) when another options field has this value. */
  showWhen?: { field: string; equals: string } | undefined;
  section?: string | undefined;
}

export const KINDS_WITH_OPTIONS: EditorFieldKind[] = ['select', 'radio'];
export const TEXT_KINDS: EditorFieldKind[] = ['text', 'textarea'];
export const NUMBER_KINDS: EditorFieldKind[] = ['integer', 'number'];

export function newField(existing: string[]): EditorField {
  let n = existing.length + 1;
  while (existing.includes(`field${n}`)) n += 1;
  return {
    name: `field${n}`,
    kind: 'text',
    title: 'New question',
    description: '',
    required: true,
    pii: false,
    options: [],
  };
}

/** Field list → stored definition. Inverse of `fromDefinition`. */
export function toDefinition(fields: EditorField[]): {
  formSchema: FormSchema;
  uiSchema: UiSchema;
} {
  const properties: Record<string, FieldSchema> = {};
  const required: string[] = [];
  const conditions = new Map<string, { field: string; equals: string; names: string[] }>();
  const sections: Record<string, string> = {};

  for (const f of fields) {
    properties[f.name] = toFieldSchema(f);
    if (f.section?.trim()) sections[f.name] = f.section.trim();
    if (f.showWhen) {
      const key = `${f.showWhen.field}=${f.showWhen.equals}`;
      const c = conditions.get(key) ?? { ...f.showWhen, names: [] };
      c.names.push(f.name);
      conditions.set(key, c);
    } else if (f.required) {
      required.push(f.name);
    }
  }
  const formSchema: FormSchema = { type: 'object', properties, required };
  if (conditions.size > 0) {
    formSchema.allOf = [...conditions.values()].map((c) => ({
      if: { properties: { [c.field]: { const: c.equals } }, required: [c.field] },
      then: { required: c.names },
    }));
  }
  const uiSchema: UiSchema = { order: fields.map((f) => f.name) };
  if (Object.keys(sections).length > 0) uiSchema.sections = sections;
  return { formSchema, uiSchema };
}

function toFieldSchema(f: EditorField): FieldSchema {
  const base = {
    title: f.title,
    ...(f.description.trim() && { description: f.description.trim() }),
    ...(f.pii && { 'x-pii': true as const }),
  };
  switch (f.kind) {
    case 'integer':
    case 'number':
      return {
        ...base,
        type: f.kind,
        ...(f.minimum !== undefined && { minimum: f.minimum }),
        ...(f.maximum !== undefined && { maximum: f.maximum }),
      };
    case 'yesno':
      return { ...base, type: 'boolean' };
    case 'select':
    case 'radio':
      return {
        ...base,
        type: 'string',
        enum: f.options.map((o) => o.value),
        'x-enumLabels': f.options.map((o) => o.label || o.value),
        ...(f.kind === 'radio' && { 'x-widget': 'radio' as const }),
      };
    default:
      return {
        ...base,
        type: 'string',
        ...(f.kind === 'email' && { format: 'email' as const }),
        ...(f.kind === 'date' && { format: 'date' as const }),
        ...(f.kind === 'textarea' && { 'x-widget': 'textarea' as const }),
        ...(f.minLength !== undefined && { minLength: f.minLength }),
        ...(f.maxLength !== undefined && { maxLength: f.maxLength }),
        ...(f.pattern?.trim() && { pattern: f.pattern.trim() }),
        ...(f.patternMessage?.trim() && { 'x-patternMessage': f.patternMessage.trim() }),
      };
  }
}

/** Stored definition → editable field list (expects a definition that passed the shared check). */
export function fromDefinition(schema: FormSchema, ui: UiSchema): EditorField[] {
  const required = new Set(schema.required);
  const showWhen = new Map<string, { field: string; equals: string }>();
  for (const c of schema.allOf ?? []) {
    const field = c.if.required[0]!;
    for (const name of c.then.required)
      showWhen.set(name, { field, equals: c.if.properties[field]!.const });
  }
  return ui.order.map((name) => {
    const s = schema.properties[name]!;
    const common = {
      name,
      title: s.title,
      description: s.description ?? '',
      required: required.has(name) || showWhen.has(name),
      pii: s['x-pii'] === true,
      showWhen: showWhen.get(name),
      section: ui.sections?.[name],
      options: [] as EditorOption[],
    };
    if (s.type === 'boolean') return { ...common, kind: 'yesno' };
    if (s.type !== 'string')
      return { ...common, kind: s.type, minimum: s.minimum, maximum: s.maximum };
    if (s.enum) {
      return {
        ...common,
        kind: s['x-widget'] === 'radio' ? 'radio' : 'select',
        options: s.enum.map((value, i) => ({ value, label: s['x-enumLabels']?.[i] ?? value })),
      };
    }
    const kind: EditorFieldKind =
      s.format === 'email'
        ? 'email'
        : s.format === 'date'
          ? 'date'
          : s['x-widget'] === 'textarea'
            ? 'textarea'
            : 'text';
    return {
      ...common,
      kind,
      minLength: s.minLength,
      maxLength: s.maxLength,
      pattern: s.pattern,
      patternMessage: s['x-patternMessage'],
    };
  });
}

export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
