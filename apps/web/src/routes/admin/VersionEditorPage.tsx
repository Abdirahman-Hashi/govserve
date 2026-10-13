import {
  checkFormDefinition,
  type FormValues,
  type RequiredDocument,
  type ServiceVersion,
  validateFormData,
} from '@govserve/shared';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { DocumentsEditor } from './editor/DocumentsEditor';
import { FieldEditor } from './editor/FieldEditor';
import {
  type EditorField,
  fromDefinition,
  KINDS_WITH_OPTIONS,
  move,
  newField,
  toDefinition,
} from './editor/form-editor-model';
import {
  useAdminServices,
  useDeleteDraft,
  usePublishVersion,
  useRetireVersion,
  useUpdateDraft,
  useVersion,
} from '../../api/catalogue';
import { ApiError } from '../../api/client';
import { DynamicForm } from '../../components/DynamicForm';
import { FeeEstimate } from '../../components/FeeEstimate';
import { FormAlert } from '../../components/form';
import { t } from '../../strings';

const e = t.versionEditor;
const input =
  'mt-1 block w-full rounded-md border border-slate-400 px-3 py-2 disabled:bg-slate-100';

type Pending = 'publish' | 'retire' | 'discard' | null;
const CONFIRM_TEXT = {
  publish: e.confirmPublish,
  retire: e.confirmRetire,
  discard: e.confirmDiscard,
} as const;

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const details = Array.isArray(err.details)
      ? (err.details as { message?: string }[]).map((d) => d.message).filter(Boolean)
      : [];
    return [err.message, ...details].join(' — ');
  }
  return t.errors.generic;
}

function Editor({ version, serviceName }: { version: ServiceVersion; serviceName: string }) {
  const navigate = useNavigate();
  const isDraft = version.status === 'DRAFT';
  const initial = checkFormDefinition(version.formSchema, version.uiSchema);
  const [fields, setFields] = useState<EditorField[]>(() =>
    initial.ok ? fromDefinition(initial.schema, initial.ui) : [],
  );
  const [docs, setDocs] = useState<RequiredDocument[]>(version.requiredDocuments);
  const [baseCents, setBaseCents] = useState(version.fee.baseCents);
  const [perCopyCents, setPerCopyCents] = useState(version.fee.perCopyCents);
  const [feeIsTest, setFeeIsTest] = useState(version.feeIsTest);
  const [preview, setPreview] = useState<FormValues>({});
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Pending>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const save = useUpdateDraft(version.id);
  const publish = usePublishVersion(version.id);
  const retire = useRetireVersion(version.id);
  const discard = useDeleteDraft(version.id);

  const definition = useMemo(() => toDefinition(fields), [fields]);
  const check = useMemo(
    () => checkFormDefinition(definition.formSchema, definition.uiSchema),
    [definition],
  );
  const feeValid = /^\d{1,12}$/.test(baseCents) && /^\d{1,12}$/.test(perCopyCents);
  const problems = [...(check.ok ? [] : check.problems), ...(feeValid ? [] : [e.centsHint])];
  const triggers = fields.filter((f) => KINDS_WITH_OPTIONS.includes(f.kind));

  const body = () => ({
    formSchema: definition.formSchema,
    uiSchema: definition.uiSchema,
    requiredDocuments: docs,
    fee: { baseCents, perCopyCents },
    feeIsTest,
  });

  const run = async (action: () => Promise<unknown>, success: string) => {
    setMessage(null);
    try {
      await action();
      setMessage({ tone: 'success', text: success });
    } catch (err) {
      setMessage({ tone: 'error', text: errorText(err) });
    }
  };

  const confirmAction = async () => {
    const which = pending;
    setPending(null);
    if (which === 'publish') {
      // Save the latest edits first so what is published is what is on screen.
      await run(async () => {
        await save.mutateAsync(body());
        await publish.mutateAsync();
      }, e.published);
    } else if (which === 'retire') {
      await run(() => retire.mutateAsync(), e.retired);
    } else if (which === 'discard') {
      try {
        await discard.mutateAsync();
        void navigate(`/admin/services/${version.serviceId}`);
      } catch (err) {
        setMessage({ tone: 'error', text: errorText(err) });
      }
    }
  };

  const busy = save.isPending || publish.isPending || retire.isPending || discard.isPending;

  return (
    <div className="space-y-8">
      <p>
        <Link to={`/admin/services/${version.serviceId}`} className="text-brand underline">
          ← {e.back}
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{e.heading(serviceName, version.versionNo)}</h1>
        <span className="rounded bg-slate-200 px-2 py-0.5 text-sm">
          {t.adminCatalogue.statuses[version.status]}
        </span>
        {feeIsTest && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-sm font-semibold text-amber-900">
            {e.testBadge}
          </span>
        )}
      </div>
      {!isDraft && <FormAlert tone="success">{e.readOnly}</FormAlert>}
      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}
      {!initial.ok && (
        <FormAlert>
          {e.invalidDefinition} {initial.problems.join('; ')}
        </FormAlert>
      )}

      <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-8">
          <section aria-labelledby="fee-h" className="space-y-3">
            <h2 id="fee-h" className="text-lg font-semibold">
              {e.feeHeading}
            </h2>
            <fieldset disabled={!isDraft} className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="fee-base" className="block text-sm font-medium">
                  {e.baseCents}
                </label>
                <input
                  id="fee-base"
                  inputMode="numeric"
                  className={input}
                  value={baseCents}
                  onChange={(ev) => setBaseCents(ev.target.value.trim())}
                  aria-describedby="fee-hint"
                />
              </div>
              <div>
                <label htmlFor="fee-copy" className="block text-sm font-medium">
                  {e.perCopyCents}
                </label>
                <input
                  id="fee-copy"
                  inputMode="numeric"
                  className={input}
                  value={perCopyCents}
                  onChange={(ev) => setPerCopyCents(ev.target.value.trim())}
                  aria-describedby="fee-hint"
                />
              </div>
              <p id="fee-hint" className="text-sm text-slate-600 sm:col-span-2">
                {e.centsHint}
              </p>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={feeIsTest}
                  onChange={(ev) => setFeeIsTest(ev.target.checked)}
                />
                {e.feeIsTest}
              </label>
            </fieldset>
          </section>

          <section aria-labelledby="fields-h" className="space-y-3">
            <h2 id="fields-h" className="text-lg font-semibold">
              {e.fieldsHeading}
            </h2>
            {fields.map((f, i) => (
              <FieldEditor
                key={i}
                field={f}
                index={i}
                count={fields.length}
                triggers={triggers}
                disabled={!isDraft}
                onChange={(next) => setFields((list) => list.map((x, j) => (j === i ? next : x)))}
                onMove={(delta) => setFields((list) => move(list, i, i + delta))}
                onRemove={() => setFields((list) => list.filter((_, j) => j !== i))}
              />
            ))}
            {isDraft && (
              <button
                type="button"
                className="rounded-md border border-brand px-3 py-1.5 text-sm font-semibold text-brand"
                onClick={() => setFields((list) => [...list, newField(list.map((f) => f.name))])}
              >
                + {e.addField}
              </button>
            )}
          </section>

          <section aria-labelledby="docs-h" className="space-y-3">
            <h2 id="docs-h" className="text-lg font-semibold">
              {e.docsHeading}
            </h2>
            <DocumentsEditor docs={docs} disabled={!isDraft} onChange={setDocs} />
          </section>

          {problems.length > 0 && isDraft && (
            <div
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
            >
              <p className="font-semibold">{e.invalidDefinition}</p>
              <ul className="list-disc pl-5">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          {pending ? (
            <div
              role="group"
              aria-label={CONFIRM_TEXT[pending]}
              className="space-y-2 rounded-md border border-slate-400 p-3"
            >
              <p>{CONFIRM_TEXT[pending]}</p>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="rounded-md bg-brand px-4 py-2 font-semibold text-white"
                  onClick={() => void confirmAction()}
                >
                  {e.confirm}
                </button>
                <button type="button" className="underline" onClick={() => setPending(null)}>
                  {e.cancel}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              {isDraft && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-md border border-brand px-4 py-2 font-semibold text-brand"
                    onClick={() => void run(() => save.mutateAsync(body()), e.saved)}
                  >
                    {e.save}
                  </button>
                  <button
                    type="button"
                    disabled={busy || problems.length > 0}
                    className="rounded-md bg-brand px-4 py-2 font-semibold text-white disabled:opacity-60"
                    onClick={() => setPending('publish')}
                  >
                    {e.publish}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="text-red-800 underline"
                    onClick={() => setPending('discard')}
                  >
                    {e.discard}
                  </button>
                </>
              )}
              {version.status === 'PUBLISHED' && (
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-md border border-red-800 px-4 py-2 font-semibold text-red-800"
                  onClick={() => setPending('retire')}
                >
                  {e.retire}
                </button>
              )}
            </div>
          )}
        </div>

        <aside aria-labelledby="preview-h" className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <h2 id="preview-h" className="text-lg font-semibold">
            {e.previewHeading}
          </h2>
          {feeValid && <FeeEstimate fee={{ baseCents, perCopyCents }} provisional={feeIsTest} />}
          {check.ok && (
            <div className="space-y-3 rounded-lg border border-slate-300 p-3">
              <DynamicForm
                schema={check.schema}
                ui={check.ui}
                values={preview}
                errors={previewErrors}
                idPrefix="pv"
                onChange={(name, value) =>
                  setPreview((v) => {
                    const next = { ...v };
                    if (value === undefined) delete next[name];
                    else next[name] = value;
                    return next;
                  })
                }
              />
              <button
                type="button"
                className="rounded-md border border-brand px-3 py-1.5 text-sm font-semibold text-brand"
                onClick={() => {
                  const r = validateFormData(check.schema, preview);
                  setPreviewErrors(r.ok ? {} : r.errors);
                }}
              >
                {t.catalogue.checkAnswers}
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export function VersionEditorPage() {
  const { id = '' } = useParams();
  const version = useVersion(id);
  const services = useAdminServices();
  if (version.isPending || services.isPending) return <p role="status">{t.loading}</p>;
  if (version.isError) return <FormAlert>{t.errors.generic}</FormAlert>;
  const serviceName = services.data?.find((s) => s.id === version.data.serviceId)?.name ?? '';
  // Re-mount when the version changes status so local edit state resets.
  return (
    <Editor
      key={`${version.data.id}-${version.data.status}`}
      version={version.data}
      serviceName={serviceName}
    />
  );
}
