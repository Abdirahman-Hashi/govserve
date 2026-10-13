import { type ReactNode } from 'react';
import { t } from '../../../strings';
import {
  type EditorField,
  type EditorFieldKind,
  KINDS_WITH_OPTIONS,
  NUMBER_KINDS,
  TEXT_KINDS,
} from './form-editor-model';

const e = t.versionEditor;
const input =
  'mt-1 block w-full rounded-md border border-slate-400 px-2 py-1.5 text-sm disabled:bg-slate-100';

function Labelled({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

const num = (v: string): number | undefined =>
  v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v);

export function optionsToText(options: EditorField['options']): string {
  return options
    .map((o) => (o.label && o.label !== o.value ? `${o.value} = ${o.label}` : o.value))
    .join('\n');
}

export function textToOptions(text: string): EditorField['options'] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [value, ...rest] = line.split('=');
      const v = (value ?? '').trim();
      return { value: v, label: rest.join('=').trim() || v };
    });
}

interface Props {
  field: EditorField;
  index: number;
  count: number;
  /** Other option fields this one can depend on (for "only show when"). */
  triggers: EditorField[];
  disabled: boolean;
  onChange: (next: EditorField) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}

export function FieldEditor({
  field,
  index,
  count,
  triggers,
  disabled,
  onChange,
  onMove,
  onRemove,
}: Props) {
  const id = `fe-${index}`;
  const set = <K extends keyof EditorField>(key: K, value: EditorField[K]) =>
    onChange({ ...field, [key]: value });
  const trigger = triggers.find((f) => f.name === field.showWhen?.field);

  return (
    <fieldset className="space-y-3 rounded-lg border border-slate-300 p-3" disabled={disabled}>
      <legend className="px-1 text-sm font-semibold">
        {index + 1}. {field.title || field.name}
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <Labelled id={`${id}-title`} label={e.title}>
          <input
            id={`${id}-title`}
            className={input}
            value={field.title}
            onChange={(ev) => set('title', ev.target.value)}
          />
        </Labelled>
        <Labelled id={`${id}-name`} label={e.fieldName}>
          <input
            id={`${id}-name`}
            className={`${input} font-mono`}
            value={field.name}
            onChange={(ev) => set('name', ev.target.value.trim())}
          />
        </Labelled>
        <Labelled id={`${id}-kind`} label={e.fieldKind}>
          <select
            id={`${id}-kind`}
            className={input}
            value={field.kind}
            onChange={(ev) => set('kind', ev.target.value as EditorFieldKind)}
          >
            {(Object.keys(e.kinds) as EditorFieldKind[]).map((k) => (
              <option key={k} value={k}>
                {e.kinds[k]}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled id={`${id}-desc`} label={e.description}>
          <input
            id={`${id}-desc`}
            className={input}
            value={field.description}
            onChange={(ev) => set('description', ev.target.value)}
          />
        </Labelled>
      </div>

      {TEXT_KINDS.includes(field.kind) && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Labelled id={`${id}-minl`} label={e.minLength}>
            <input
              id={`${id}-minl`}
              inputMode="numeric"
              className={input}
              value={field.minLength ?? ''}
              onChange={(ev) => set('minLength', num(ev.target.value))}
            />
          </Labelled>
          <Labelled id={`${id}-maxl`} label={e.maxLength}>
            <input
              id={`${id}-maxl`}
              inputMode="numeric"
              className={input}
              value={field.maxLength ?? ''}
              onChange={(ev) => set('maxLength', num(ev.target.value))}
            />
          </Labelled>
          <Labelled id={`${id}-pat`} label={e.pattern}>
            <input
              id={`${id}-pat`}
              className={`${input} font-mono`}
              value={field.pattern ?? ''}
              onChange={(ev) => set('pattern', ev.target.value)}
            />
          </Labelled>
          <Labelled id={`${id}-patm`} label={e.patternMessage}>
            <input
              id={`${id}-patm`}
              className={input}
              value={field.patternMessage ?? ''}
              onChange={(ev) => set('patternMessage', ev.target.value)}
            />
          </Labelled>
        </div>
      )}

      {NUMBER_KINDS.includes(field.kind) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Labelled id={`${id}-min`} label={e.minimum}>
            <input
              id={`${id}-min`}
              inputMode="decimal"
              className={input}
              value={field.minimum ?? ''}
              onChange={(ev) => set('minimum', num(ev.target.value))}
            />
          </Labelled>
          <Labelled id={`${id}-max`} label={e.maximum}>
            <input
              id={`${id}-max`}
              inputMode="decimal"
              className={input}
              value={field.maximum ?? ''}
              onChange={(ev) => set('maximum', num(ev.target.value))}
            />
          </Labelled>
        </div>
      )}

      {KINDS_WITH_OPTIONS.includes(field.kind) && (
        <Labelled id={`${id}-opts`} label={e.options}>
          <textarea
            id={`${id}-opts`}
            rows={Math.max(3, field.options.length + 1)}
            className={`${input} font-mono`}
            defaultValue={optionsToText(field.options)}
            onBlur={(ev) => set('options', textToOptions(ev.target.value))}
          />
        </Labelled>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Labelled id={`${id}-when`} label={e.showWhen}>
          <select
            id={`${id}-when`}
            className={input}
            value={field.showWhen ? `${field.showWhen.field}=${field.showWhen.equals}` : ''}
            onChange={(ev) => {
              const [f, v] = ev.target.value.split('=');
              set('showWhen', f && v ? { field: f, equals: v } : undefined);
            }}
          >
            <option value="">{e.always}</option>
            {triggers
              .filter((tf) => tf.name !== field.name)
              .flatMap((tf) =>
                tf.options.map((o) => (
                  <option key={`${tf.name}=${o.value}`} value={`${tf.name}=${o.value}`}>
                    {tf.title} = {o.label}
                  </option>
                )),
              )}
          </select>
          {trigger === undefined && field.showWhen && (
            <span className="text-xs text-red-800">✕ {field.showWhen.field}</span>
          )}
        </Labelled>
        <Labelled id={`${id}-section`} label={e.section}>
          <input
            id={`${id}-section`}
            className={input}
            value={field.section ?? ''}
            onChange={(ev) => set('section', ev.target.value)}
          />
        </Labelled>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={field.required || Boolean(field.showWhen)}
            disabled={Boolean(field.showWhen)}
            onChange={(ev) => set('required', ev.target.checked)}
          />
          {e.required}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={field.pii}
            onChange={(ev) => set('pii', ev.target.checked)}
          />
          {e.pii}
        </label>
        <span className="ml-auto flex gap-3">
          <button
            type="button"
            className="underline"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label={`${e.moveUp}: ${field.title}`}
          >
            ↑ {e.moveUp}
          </button>
          <button
            type="button"
            className="underline"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
            aria-label={`${e.moveDown}: ${field.title}`}
          >
            ↓ {e.moveDown}
          </button>
          <button
            type="button"
            className="text-red-800 underline"
            onClick={onRemove}
            aria-label={`${e.remove}: ${field.title}`}
          >
            {e.remove}
          </button>
        </span>
      </div>
    </fieldset>
  );
}
