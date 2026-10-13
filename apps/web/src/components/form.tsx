import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

const inputClass =
  'mt-1 block w-full rounded-md border border-slate-400 px-3 py-2 text-base aria-[invalid=true]:border-red-700';

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string;
  name: string;
}

export function TextField({
  label,
  error,
  hint,
  ...input
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const hintId = hint ? `${input.name}-hint` : undefined;
  const describedBy = [input['aria-describedby'], hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={input.id ?? input.name} className="block text-sm font-medium">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-slate-600">
          {hint}
        </p>
      )}
      <input
        {...input}
        id={input.id ?? input.name}
        aria-describedby={describedBy}
        className={inputClass}
      />
      <FieldError name={input.name} error={error} />
    </div>
  );
}

export function SelectField({
  label,
  error,
  options,
  ...select
}: FieldProps &
  SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  return (
    <div>
      <label htmlFor={select.id ?? select.name} className="block text-sm font-medium">
        {label}
      </label>
      <select {...select} id={select.id ?? select.name} className={inputClass}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldError name={select.name} error={error} />
    </div>
  );
}

function FieldError({ name, error }: { name: string; error?: string | undefined }) {
  if (!error) return null;
  return (
    <p id={`${name}-error`} className="mt-1 text-sm text-red-800">
      <span aria-hidden="true">✕ </span>
      {error}
    </p>
  );
}

export function FormAlert({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'success';
  children: ReactNode;
}) {
  const styles =
    tone === 'error'
      ? 'border-red-300 bg-red-50 text-red-900'
      : 'border-green-300 bg-green-50 text-green-900';
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-md border p-3 text-sm ${styles}`}
    >
      <span aria-hidden="true">{tone === 'error' ? '✕ ' : '✓ '}</span>
      {children}
    </div>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="w-full rounded-md bg-brand px-4 py-3 font-semibold text-white hover:bg-brand-dark disabled:opacity-60 sm:w-auto"
    >
      {children}
    </button>
  );
}

export function AuthCard({
  heading,
  intro,
  children,
}: {
  heading: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold">{heading}</h1>
      {intro && <p className="text-slate-700">{intro}</p>}
      {children}
    </div>
  );
}
