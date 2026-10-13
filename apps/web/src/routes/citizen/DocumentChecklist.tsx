import {
  type ApplicationDetail,
  documentCompleteness,
  type DocumentDto,
  type RequiredDocument,
} from '@govserve/shared';
import { useRef, useState } from 'react';
import {
  completeUpload,
  downloadTicket,
  requestUpload,
  useInvalidateApplication,
  useRemoveDocument,
} from '../../api/applications';
import { ApiError } from '../../api/client';
import { FileProblem, prepareFile, putWithProgress } from '../../files/prepare';
import { t } from '../../strings';

const d = t.applications.docs;

type Progress =
  | { state: 'uploading'; pct: number }
  | { state: 'checking' }
  | { state: 'error'; message: string }
  | null;

function DocumentRow({
  app,
  spec,
  current,
  disabled,
}: {
  app: ApplicationDetail;
  spec: RequiredDocument;
  current?: DocumentDto;
  disabled: boolean;
}) {
  const [progress, setProgress] = useState<Progress>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const refresh = useInvalidateApplication(app.id);
  const remove = useRemoveDocument(app.id);
  const id = `doc-${spec.type}`;

  const uploadFile = async (file: File) => {
    setLastFile(file);
    try {
      setProgress({ state: 'uploading', pct: 0 });
      const prepared = await prepareFile(file, spec.mime);
      const ticket = await requestUpload(app.id, {
        docType: spec.type,
        fileName: prepared.name,
        mime: prepared.mime,
        sizeBytes: prepared.blob.size,
        sha256: prepared.sha256,
      });
      await putWithProgress(ticket.uploadUrl, ticket.headers, prepared.blob, (f) =>
        setProgress({ state: 'uploading', pct: Math.round(f * 100) }),
      );
      setProgress({ state: 'checking' });
      await completeUpload(ticket.document.id);
      setProgress(null);
      await refresh();
    } catch (err) {
      const message =
        err instanceof FileProblem
          ? (d.problems[err.message as keyof typeof d.problems] ?? d.problems.failed)
          : err instanceof ApiError
            ? err.message
            : d.problems.failed;
      setProgress({ state: 'error', message });
      await refresh();
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const status =
    progress?.state === 'uploading'
      ? d.uploading(progress.pct)
      : progress?.state === 'checking'
        ? d.checking
        : current
          ? d.statuses[current.status]
          : d.missing;
  const ok = current?.status === 'CLEAN' && !progress;

  return (
    <li className="space-y-2 rounded-lg border border-slate-300 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {spec.label}{' '}
          {!spec.required && !spec.oneOfGroup && (
            <span className="font-normal text-slate-600">{d.optional}</span>
          )}
        </span>
        <span
          role="status"
          className={`text-sm ${ok ? 'text-green-800' : current?.status === 'INFECTED' || current?.status === 'REJECTED' ? 'text-red-800' : 'text-slate-700'}`}
        >
          <span aria-hidden="true">{ok ? '✓ ' : ''}</span>
          {status}
        </span>
      </div>
      {spec.description && <p className="text-sm text-slate-600">{spec.description}</p>}
      {current && (
        <p className="text-sm text-slate-600">
          {current.originalName}
          {current.statusReason ? ` — ${current.statusReason}` : ''}
        </p>
      )}
      {progress?.state === 'uploading' && (
        <progress className="h-2 w-full" max={100} value={progress.pct} aria-label={status} />
      )}
      {progress?.state === 'error' && (
        <p role="alert" className="text-sm text-red-800">
          ✕ {progress.message}
        </p>
      )}
      {!disabled && (
        <div className="flex flex-wrap items-center gap-3">
          <label
            htmlFor={id}
            className="cursor-pointer rounded-md border border-brand px-3 py-1.5 text-sm font-semibold text-brand focus-within:outline"
          >
            {current ? d.replace : d.choose}
            <span className="sr-only">: {spec.label}</span>
            <input
              ref={input}
              id={id}
              type="file"
              accept={spec.mime.join(',')}
              className="sr-only"
              disabled={progress?.state === 'uploading' || progress?.state === 'checking'}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadFile(file);
              }}
            />
          </label>
          {progress?.state === 'error' && lastFile && (
            <button
              type="button"
              className="text-sm underline"
              onClick={() => void uploadFile(lastFile)}
            >
              {d.retry}
            </button>
          )}
          {current && (
            <button
              type="button"
              className="text-sm text-red-800 underline"
              disabled={remove.isPending}
              onClick={() => remove.mutate(current.id)}
            >
              {d.remove}
              <span className="sr-only">: {spec.label}</span>
            </button>
          )}
          {current?.status === 'CLEAN' && (
            <button
              type="button"
              className="text-sm underline"
              onClick={() =>
                void downloadTicket(current.id).then((ticket) =>
                  window.open(ticket.url, '_blank', 'noopener'),
                )
              }
            >
              {t.applications.detail.download}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function DocumentChecklist({
  app,
  disabled = false,
}: {
  app: ApplicationDetail;
  disabled?: boolean;
}) {
  const byType = new Map(app.documents.map((doc) => [doc.docType, doc]));
  const singles = app.requiredDocuments.filter((s) => !s.oneOfGroup);
  const groups = new Map<string, RequiredDocument[]>();
  for (const s of app.requiredDocuments)
    if (s.oneOfGroup) groups.set(s.oneOfGroup, [...(groups.get(s.oneOfGroup) ?? []), s]);
  const lockedTo = app.editableDocTypes;
  const isDisabled = (type: string) => disabled || (lockedTo !== null && !lockedTo.includes(type));
  const check = documentCompleteness(app.requiredDocuments, app.documents);

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {singles.map((s) => (
          <DocumentRow
            key={s.type}
            app={app}
            spec={s}
            current={byType.get(s.type)}
            disabled={isDisabled(s.type)}
          />
        ))}
      </ul>
      {[...groups.entries()].map(([group, members]) => (
        <fieldset key={group} className="space-y-2">
          <legend className="font-semibold">
            {d.anyOne}
            {!check.missing.includes(group) && (
              <span className="ml-2 text-sm font-normal text-green-800">✓</span>
            )}
          </legend>
          <ul className="space-y-3">
            {members.map((s) => (
              <DocumentRow
                key={s.type}
                app={app}
                spec={s}
                current={byType.get(s.type)}
                disabled={isDisabled(s.type)}
              />
            ))}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}
