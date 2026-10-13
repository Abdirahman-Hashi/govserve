import { MAX_UPLOAD_BYTES, MIME_TYPES, type RequiredDocument } from '@govserve/shared';
import { t } from '../../../strings';

const e = t.versionEditor;
const input =
  'mt-1 block w-full rounded-md border border-slate-400 px-2 py-1.5 text-sm disabled:bg-slate-100';
const MIME_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
};

/** "File" questions in the editor: each is a document slot the applicant uploads (Phase 04). */
export function DocumentsEditor({
  docs,
  disabled,
  onChange,
}: {
  docs: RequiredDocument[];
  disabled: boolean;
  onChange: (docs: RequiredDocument[]) => void;
}) {
  const update = (i: number, patch: Partial<RequiredDocument>) =>
    onChange(docs.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  return (
    <div className="space-y-3">
      {docs.map((d, i) => {
        const id = `doc-${i}`;
        return (
          <fieldset
            key={i}
            disabled={disabled}
            className="grid gap-3 rounded-lg border border-slate-300 p-3 sm:grid-cols-2"
          >
            <legend className="px-1 text-sm font-semibold">{d.label || d.type}</legend>
            <div>
              <label htmlFor={`${id}-label`} className="block text-xs font-medium">
                {e.docLabel}
              </label>
              <input
                id={`${id}-label`}
                className={input}
                value={d.label}
                onChange={(ev) => update(i, { label: ev.target.value })}
              />
            </div>
            <div>
              <label htmlFor={`${id}-type`} className="block text-xs font-medium">
                {e.docType}
              </label>
              <input
                id={`${id}-type`}
                className={`${input} font-mono`}
                value={d.type}
                onChange={(ev) => update(i, { type: ev.target.value.trim().toUpperCase() })}
              />
            </div>
            <div>
              <label htmlFor={`${id}-group`} className="block text-xs font-medium">
                {e.docGroup}
              </label>
              <input
                id={`${id}-group`}
                className={`${input} font-mono`}
                value={d.oneOfGroup ?? ''}
                onChange={(ev) => {
                  const g = ev.target.value.trim().toUpperCase();
                  const { oneOfGroup: _drop, ...rest } = d;
                  onChange(
                    docs.map((x, j) => (j === i ? (g ? { ...rest, oneOfGroup: g } : rest) : x)),
                  );
                }}
              />
            </div>
            <div>
              <label htmlFor={`${id}-mb`} className="block text-xs font-medium">
                {e.docMaxMb}
              </label>
              <input
                id={`${id}-mb`}
                inputMode="numeric"
                className={input}
                value={Math.round(d.maxBytes / 1048576)}
                onChange={(ev) =>
                  update(i, {
                    maxBytes: Math.min(
                      MAX_UPLOAD_BYTES,
                      Math.max(1, Number(ev.target.value) || 1) * 1048576,
                    ),
                  })
                }
              />
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm sm:col-span-2">
              {MIME_TYPES.map((m) => (
                <label key={m} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={d.mime.includes(m)}
                    onChange={(ev) =>
                      update(i, {
                        mime: ev.target.checked ? [...d.mime, m] : d.mime.filter((x) => x !== m),
                      })
                    }
                  />
                  {MIME_LABELS[m]}
                </label>
              ))}
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={d.required}
                  onChange={(ev) => update(i, { required: ev.target.checked })}
                />
                {e.docRequired}
              </label>
              <button
                type="button"
                className="ml-auto text-red-800 underline"
                onClick={() => onChange(docs.filter((_, j) => j !== i))}
              >
                {e.remove}
              </button>
            </div>
          </fieldset>
        );
      })}
      {!disabled && (
        <button
          type="button"
          className="rounded-md border border-brand px-3 py-1.5 text-sm font-semibold text-brand"
          onClick={() =>
            onChange([
              ...docs,
              {
                type: `DOCUMENT_${docs.length + 1}`,
                label: 'New document',
                mime: [...MIME_TYPES],
                maxBytes: MAX_UPLOAD_BYTES,
                required: true,
              },
            ])
          }
        >
          + {e.addDoc}
        </button>
      )}
    </div>
  );
}
