import { type ReactNode, useId } from 'react';

const control = 'mt-1 block w-full rounded-md border border-slate-400 px-3 py-2 text-base';

/** A labelled filter control (text, date or select), full width on phones. */
export function FilterField({
  label,
  value,
  onChange,
  type = 'text',
  options,
  anyLabel,
  autoComplete = 'off',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'date' | 'select';
  /** [value, label] pairs for a select; the first option is "any". */
  options?: [string, string][];
  anyLabel?: string;
  autoComplete?: string;
}) {
  const id = useId();
  let input: ReactNode;
  if (type === 'select') {
    input = (
      <select id={id} className={control} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{anyLabel}</option>
        {options?.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    );
  } else {
    input = (
      <input
        id={id}
        type={type}
        className={control}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {input}
    </div>
  );
}
