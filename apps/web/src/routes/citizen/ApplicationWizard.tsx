import {
  type ApplicationDetail,
  documentCompleteness,
  type FieldSchema,
  type FormValues,
  isFieldActive,
  type UiSchema,
  validateFormData,
} from '@govserve/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useSaveApplication, useSubmitApplication } from '../../api/applications';
import { ApiError } from '../../api/client';
import { DynamicForm } from '../../components/DynamicForm';
import { FeeEstimate } from '../../components/FeeEstimate';
import { FormAlert } from '../../components/form';
import { t } from '../../strings';
import { DocumentChecklist } from './DocumentChecklist';
import { type SaveState, useAutosave } from './useAutosave';

const a = t.applications;

/** Splits the form into steps at each section heading (one step if there are none). */
export function formSteps(ui: UiSchema): { title: string; fields: string[] }[] {
  const steps: { title: string; fields: string[] }[] = [];
  for (const name of ui.order) {
    const heading = ui.sections?.[name];
    if (heading || steps.length === 0)
      steps.push({ title: heading ?? a.steps.details, fields: [] });
    steps[steps.length - 1]!.fields.push(name);
  }
  return steps;
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  const text = state === 'saving' ? a.saving : state === 'saved' ? a.saved : a.saveFailed;
  return (
    <p
      role="status"
      aria-live="polite"
      className={`text-sm ${state === 'error' ? 'text-red-800' : 'text-slate-600'}`}
    >
      {state === 'saved' && <span aria-hidden="true">✓ </span>}
      {text}
    </p>
  );
}

function display(field: FieldSchema, value: FormValues[string] | undefined): string {
  if (value === undefined) return a.review.noAnswer;
  if (field.type === 'boolean') return value ? a.review.yes : a.review.no;
  if (field.type === 'string' && field.enum) {
    const i = field.enum.indexOf(String(value));
    return field['x-enumLabels']?.[i] ?? String(value);
  }
  return String(value);
}

export function ApplicationWizard({ app }: { app: ApplicationDetail }) {
  const navigate = useNavigate();
  const autosave = useAutosave(app.id, app.formData);
  const saveCopies = useSaveApplication(app.id);
  // The last copy-count save; submit waits for it so the fee is assessed on what the citizen chose.
  const [copiesSaved, setCopiesSaved] = useState<Promise<unknown>>(() => Promise.resolve());
  const submit = useSubmitApplication(app.id);
  const formStepList = formSteps(app.uiSchema);
  const total = formStepList.length + 2;
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitProblems, setSubmitProblems] = useState<string[]>([]);

  const go = (n: number) => {
    setStep(n);
    window.scrollTo({ top: 0 });
  };

  const continueFromFormStep = () => {
    const fields = formStepList[step]!.fields;
    const result = validateFormData(app.formSchema, autosave.values);
    const stepErrors = result.ok
      ? {}
      : Object.fromEntries(Object.entries(result.errors).filter(([k]) => fields.includes(k)));
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length === 0) go(step + 1);
  };

  const changeCopies = (copies: number) => {
    const saving = saveCopies.mutateAsync({ extraCopies: copies });
    saving.catch(() => undefined); // reported when submitting
    setCopiesSaved(saving);
  };

  const doSubmit = async () => {
    setSubmitProblems([]);
    if (!(await autosave.flush())) return;
    try {
      await copiesSaved;
    } catch {
      setSubmitProblems([a.review.copiesNotSaved]);
      return;
    }
    try {
      await submit.mutateAsync();
      void navigate(`/citizen/applications/${app.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        const labels = (path: string) => {
          const [kind, key = ''] = path.split('.');
          if (kind === 'formData') return app.formSchema.properties[key]?.title ?? key;
          return (
            app.requiredDocuments.find((d) => d.type === key)?.label ?? (key ? a.docs.anyOne : key)
          );
        };
        setSubmitProblems(
          (err.details as { path: string; message: string }[]).map(
            (d) => `${labels(d.path)}: ${d.message}`,
          ),
        );
      } else {
        setSubmitProblems([err instanceof ApiError ? err.message : t.errors.generic]);
      }
    }
  };

  const header = (title: string) => (
    <div className="space-y-1">
      <p className="text-sm text-slate-600">
        {app.serviceName} · {a.stepOf(step + 1, total)}
      </p>
      <h1 className="text-2xl font-bold">{title}</h1>
      <SaveIndicator state={autosave.state} />
    </div>
  );

  const nav = (onNext?: () => void, nextLabel: string = a.next) => (
    <div className="flex flex-wrap gap-3 pt-2">
      {step > 0 && (
        <button
          type="button"
          className="rounded-md border border-slate-400 px-4 py-2"
          onClick={() => go(step - 1)}
        >
          {a.back}
        </button>
      )}
      {onNext && (
        <button
          type="button"
          className="rounded-md bg-brand px-4 py-2 font-semibold text-white"
          onClick={onNext}
        >
          {nextLabel}
        </button>
      )}
    </div>
  );

  // ─── Form steps ───────────────────────────────────────────────────────────
  if (step < formStepList.length) {
    const current = formStepList[step]!;
    return (
      <div className="max-w-xl space-y-6">
        {header(current.title)}
        {Object.keys(errors).length > 0 && <FormAlert>{a.fixStep}</FormAlert>}
        <DynamicForm
          schema={app.formSchema}
          ui={{ order: current.fields }}
          values={autosave.values}
          onChange={autosave.setField}
          errors={errors}
          idPrefix="app"
        />
        {nav(continueFromFormStep)}
      </div>
    );
  }

  // ─── Documents ────────────────────────────────────────────────────────────
  if (step === formStepList.length) {
    return (
      <div className="max-w-xl space-y-6">
        {header(a.docs.heading)}
        <p className="text-slate-700">{a.docs.intro}</p>
        <DocumentChecklist app={app} />
        {nav(() => go(step + 1))}
      </div>
    );
  }

  // ─── Review and submit ────────────────────────────────────────────────────
  const docs = documentCompleteness(app.requiredDocuments, app.documents);
  return (
    <div className="max-w-xl space-y-6">
      {header(a.review.heading)}
      {formStepList.map((s, i) => (
        <section key={s.title} aria-labelledby={`review-${i}`} className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 id={`review-${i}`} className="text-lg font-semibold">
              {s.title}
            </h2>
            <button type="button" className="text-sm underline" onClick={() => go(i)}>
              {a.review.edit}
              <span className="sr-only">: {s.title}</span>
            </button>
          </div>
          <dl className="divide-y divide-slate-200 text-sm">
            {s.fields
              .filter((f) => isFieldActive(app.formSchema, f, autosave.values))
              .map((f) => (
                <div key={f} className="grid grid-cols-2 gap-2 py-1.5">
                  <dt className="text-slate-600">{app.formSchema.properties[f]!.title}</dt>
                  <dd>{display(app.formSchema.properties[f]!, autosave.values[f])}</dd>
                </div>
              ))}
          </dl>
        </section>
      ))}
      <section aria-labelledby="review-docs" className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 id="review-docs" className="text-lg font-semibold">
            {a.steps.documents}
          </h2>
          <button
            type="button"
            className="text-sm underline"
            onClick={() => go(formStepList.length)}
          >
            {a.review.edit}
            <span className="sr-only">: {a.steps.documents}</span>
          </button>
        </div>
        <ul className="text-sm">
          {app.documents.map((d) => (
            <li key={d.id}>
              {app.requiredDocuments.find((r) => r.type === d.docType)?.label ?? d.docType}:{' '}
              {a.docs.statuses[d.status]}
            </li>
          ))}
          {docs.missing.length > 0 && (
            <li className="text-red-800">
              ✕ {a.docs.missing}: {docs.missing.length}
            </li>
          )}
        </ul>
      </section>
      <FeeEstimate
        fee={app.fee}
        provisional={app.feeProvisional}
        copies={app.extraCopies}
        onCopiesChange={changeCopies}
      />
      {submitProblems.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
        >
          <p className="font-semibold">{a.review.cannotSubmit}</p>
          <ul className="list-disc pl-5">
            {submitProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-sm text-slate-700">{a.review.declaration}</p>
      {nav(() => void doSubmit(), submit.isPending ? a.review.submitting : a.review.submit)}
    </div>
  );
}
