import { type ApplicationDetail, validateFormData } from '@govserve/shared';
import { useState } from 'react';
import { useResubmitApplication } from '../../api/applications';
import { ApiError } from '../../api/client';
import { DynamicForm } from '../../components/DynamicForm';
import { t } from '../../strings';
import { DocumentChecklist } from './DocumentChecklist';
import { useAutosave } from './useAutosave';

const c = t.corrections;

/** FR-074: only the flagged answers and documents can change; everything else stays locked. */
export function CorrectionView({ app }: { app: ApplicationDetail }) {
  const autosave = useAutosave(app.id, app.formData);
  const resubmit = useResubmitApplication(app.id);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<string[]>([]);
  const correction = app.correction!;
  const fields = app.editableFields ?? [];
  const comments = (kind: 'FIELD' | 'DOCUMENT') => correction.items.filter((i) => i.kind === kind);
  const label = (path: string) => {
    const [kind, key = ''] = path.split('.');
    if (kind === 'formData') return app.formSchema.properties[key]?.title ?? key;
    return app.requiredDocuments.find((d) => d.type === key)?.label ?? key;
  };

  const send = async () => {
    setProblems([]);
    const result = validateFormData(app.formSchema, autosave.values);
    const fieldErrors = result.ok
      ? {}
      : Object.fromEntries(Object.entries(result.errors).filter(([k]) => fields.includes(k)));
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;
    if (!(await autosave.flush())) return;
    try {
      await resubmit.mutateAsync();
    } catch (err) {
      setProblems(
        err instanceof ApiError && Array.isArray(err.details)
          ? (err.details as { path: string; message: string }[]).map(
              (d) => `${label(d.path)}: ${d.message}`,
            )
          : [err instanceof ApiError ? err.message : t.errors.generic],
      );
    }
  };

  const due = new Date(correction.dueAt).toLocaleDateString('en-GB', {
    timeZone: 'Africa/Mogadishu',
    dateStyle: 'long',
  });

  return (
    <section
      aria-labelledby="corrections"
      className="space-y-6 rounded-lg border-2 border-amber-500 p-4"
    >
      <div className="space-y-2">
        <h2 id="corrections" className="text-xl font-bold">
          {c.heading}
        </h2>
        <p>{c.intro(correction.round, due)}</p>
      </div>
      {fields.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold">{c.fieldsHeading}</h3>
          <ul className="space-y-1 text-sm">
            {comments('FIELD').map((i) => (
              <li key={i.target}>
                <span className="font-medium">{label(`formData.${i.target}`)}</span> —{' '}
                {c.officerSays}: {i.comment}
              </li>
            ))}
          </ul>
          <DynamicForm
            schema={app.formSchema}
            ui={{ order: fields }}
            values={autosave.values}
            onChange={autosave.setField}
            errors={errors}
            idPrefix="corr"
          />
        </div>
      )}
      {comments('DOCUMENT').length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold">{c.docsHeading}</h3>
          <ul className="space-y-1 text-sm">
            {comments('DOCUMENT').map((i) => (
              <li key={i.target}>
                <span className="font-medium">{label(`documents.${i.target}`)}</span> —{' '}
                {c.officerSays}: {i.comment}
              </li>
            ))}
          </ul>
          <DocumentChecklist app={app} />
        </div>
      )}
      {problems.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
        >
          <p className="font-semibold">{c.problems}</p>
          <ul className="list-disc pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        className="rounded-md bg-brand px-4 py-2 font-semibold text-white"
        disabled={resubmit.isPending}
        onClick={() => void send()}
      >
        {resubmit.isPending ? c.resubmitting : c.resubmit}
      </button>
    </section>
  );
}
