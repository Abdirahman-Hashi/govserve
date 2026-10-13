import {
  type FieldSchema,
  type FormSchema,
  type FormValues,
  isFieldActive,
  type UiSchema,
} from '@govserve/shared';
import { type ReactNode } from 'react';
import { t } from '../strings';

const inputClass =
  'mt-1 block w-full rounded-md border border-slate-400 px-3 py-2 text-base aria-[invalid=true]:border-red-700 disabled:bg-slate-100';

export interface DynamicFormProps {
  schema: FormSchema;
  ui: UiSchema;
  values: FormValues;
  onChange: (name: string, value: string | number | boolean | undefined) => void;
  errors?: Record<string, string>;
  /** Prefix for element IDs so two forms can share a page (e.g. editor + preview). */
  idPrefix?: string;
  disabled?: boolean;
}

/**
 * Renders a service form from its schema (FR-021). Validation is not done here: callers run
 * the shared `validateFormData`, the same function the API uses on submit.
 */
export function DynamicForm({
  schema,
  ui,
  values,
  onChange,
  errors = {},
  idPrefix = 'f',
  disabled = false,
}: DynamicFormProps) {
  const required = new Set(schema.required);
  const items: ReactNode[] = [];
  for (const name of ui.order) {
    const field = schema.properties[name];
    if (!field || !isFieldActive(schema, name, values)) continue;
    const heading = ui.sections?.[name];
    if (heading) {
      items.push(
        <h2 key={`${name}-section`} className="pt-2 text-lg font-semibold">
          {heading}
        </h2>,
      );
    }
    const isRequired = required.has(name) || isConditionallyRequired(schema, name);
    items.push(
      <Field
        key={name}
        id={`${idPrefix}-${name}`}
        name={name}
        field={field}
        required={isRequired}
        value={values[name]}
        error={errors[name]}
        disabled={disabled}
        onChange={(v) => onChange(name, v)}
      />,
    );
  }
  return <div className="space-y-4">{items}</div>;
}

function isConditionallyRequired(schema: FormSchema, name: string): boolean {
  return (schema.allOf ?? []).some((c) => c.then.required.includes(name));
}

interface FieldProps {
  id: string;
  name: string;
  field: FieldSchema;
  required: boolean;
  value: string | number | boolean | undefined;
  error: string | undefined;
  disabled: boolean;
  onChange: (value: string | number | boolean | undefined) => void;
}

function Field({ id, field, required, value, error, disabled, onChange }: FieldProps) {
  const hintId = field.description ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const label = (
    <>
      {field.title}
      {!required && <span className="font-normal text-slate-600"> {t.form.optional}</span>}
    </>
  );
  const hint = field.description && (
    <p id={hintId} className="text-sm text-slate-600">
      {field.description}
    </p>
  );
  const errorText = error && (
    <p id={errorId} className="mt-1 text-sm text-red-800">
      <span aria-hidden="true">✕ </span>
      {error}
    </p>
  );
  const common = {
    id,
    name: id,
    disabled,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
  };

  // Option sets (radio or select) and yes/no questions are grouped in a fieldset.
  const options =
    field.type === 'string' && field.enum
      ? field.enum.map((v, i) => ({ value: v, label: field['x-enumLabels']?.[i] ?? v }))
      : field.type === 'boolean'
        ? [
            { value: 'true', label: t.form.yes },
            { value: 'false', label: t.form.no },
          ]
        : null;
  const useRadios =
    options &&
    (field.type === 'boolean' || (field.type === 'string' && field['x-widget'] === 'radio'));

  if (options && useRadios) {
    const current = value === undefined ? '' : String(value);
    return (
      <fieldset aria-describedby={describedBy} aria-invalid={error ? true : undefined}>
        <legend className="text-sm font-medium">{label}</legend>
        {hint}
        <div className="mt-1 space-y-2">
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2">
              <input
                type="radio"
                name={id}
                value={o.value}
                checked={current === o.value}
                disabled={disabled}
                onChange={() => onChange(field.type === 'boolean' ? o.value === 'true' : o.value)}
                className="h-5 w-5"
              />
              {o.label}
            </label>
          ))}
        </div>
        {errorText}
      </fieldset>
    );
  }

  let control: ReactNode;
  if (options) {
    control = (
      <select
        {...common}
        value={value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value || undefined)}
        className={inputClass}
      >
        <option value="">{t.form.choose}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (field.type === 'integer' || field.type === 'number') {
    control = (
      <input
        {...common}
        type="text"
        inputMode={field.type === 'integer' ? 'numeric' : 'decimal'}
        value={value === undefined ? '' : String(value)}
        // Keep what the user typed if it is not a number, so validation can say so.
        onChange={(e) => {
          const raw = e.target.value.trim();
          const n = Number(raw);
          onChange(raw === '' ? undefined : Number.isFinite(n) ? n : raw);
        }}
        className={inputClass}
      />
    );
  } else if (field.type === 'string' && field['x-widget'] === 'textarea') {
    control = (
      <textarea
        {...common}
        rows={3}
        value={(value as string | undefined) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    );
  } else {
    const type =
      field.type === 'string' && field.format === 'date'
        ? 'date'
        : field.type === 'string' && field.format === 'email'
          ? 'email'
          : 'text';
    control = (
      <input
        {...common}
        type={type}
        value={(value as string | undefined) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    );
  }

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {hint}
      {control}
      {errorText}
    </div>
  );
}
