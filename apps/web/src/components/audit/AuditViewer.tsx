import { type FormEvent, useState } from 'react';
import { type AuditFilters, downloadAudit, useAuditLog, useVerifyAudit } from '../../api/audit';
import { ApiError } from '../../api/client';
import { t } from '../../strings';
import { FilterField } from '../FilterField';
import { FormAlert } from '../form';
import { AuditEntries } from './AuditEntries';

const a = t.audit;
const EMPTY = { entityType: '', entityId: '', action: '', actorId: '', from: '', to: '' };

function VerifyPanel() {
  const verify = useVerifyAudit();
  const r = verify.data;
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="rounded-md border border-slate-400 px-4 py-2 font-semibold"
        disabled={verify.isPending}
        onClick={() => verify.mutate()}
      >
        {verify.isPending ? a.verify.running : a.verify.button}
      </button>
      {r && (
        <FormAlert tone={r.ok ? 'success' : 'error'}>
          {r.ok || !r.broken
            ? a.verify.ok(r.rows)
            : a.verify.broken(
                r.broken.chainSeq,
                a.verify.problems[r.broken.problem] ?? r.broken.problem,
              )}
        </FormAlert>
      )}
      {verify.isError && <FormAlert>{t.errors.generic}</FormAlert>}
    </div>
  );
}

/** FR-132: the read-only audit viewer. The API scopes supervisors to their department. */
export function AuditViewer({ admin }: { admin: boolean }) {
  const [draft, setDraft] = useState(EMPTY);
  const [filters, setFilters] = useState<AuditFilters>({});
  const [exportError, setExportError] = useState(false);
  const log = useAuditLog(filters);
  const items = log.data?.pages.flatMap((p) => p.items) ?? [];
  const set = (k: keyof typeof EMPTY) => (v: string) => setDraft({ ...draft, [k]: v });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{a.heading}</h1>
        <p className="text-slate-700">{a.intro}</p>
      </div>
      {admin && <VerifyPanel />}
      <form
        aria-label={a.heading}
        className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setFilters(
            Object.fromEntries(
              Object.entries(draft)
                .map(([k, v]) => [k, k === 'action' ? v.trim().toUpperCase() : v.trim()])
                .filter(([, v]) => v !== ''),
            ) as AuditFilters,
          );
        }}
      >
        <FilterField
          label={a.filters.entityType}
          type="select"
          anyLabel={a.filters.any}
          value={draft.entityType}
          onChange={set('entityType')}
          options={a.entityTypes.map((x) => [x, x])}
        />
        <FilterField label={a.filters.entityId} value={draft.entityId} onChange={set('entityId')} />
        <FilterField label={a.filters.action} value={draft.action} onChange={set('action')} />
        <FilterField label={a.filters.actorId} value={draft.actorId} onChange={set('actorId')} />
        <FilterField label={a.filters.from} type="date" value={draft.from} onChange={set('from')} />
        <FilterField label={a.filters.to} type="date" value={draft.to} onChange={set('to')} />
        <div className="flex flex-wrap items-end gap-3 sm:col-span-3 lg:col-span-6">
          <button type="submit" className="rounded-md bg-brand px-4 py-2 font-semibold text-white">
            {a.filters.apply}
          </button>
          <button
            type="button"
            className="underline"
            onClick={() => {
              setDraft(EMPTY);
              setFilters({});
            }}
          >
            {a.filters.clear}
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-400 px-3 py-2 text-sm"
            onClick={() => void downloadAudit(filters).catch(() => setExportError(true))}
          >
            {a.export}
          </button>
        </div>
      </form>
      {exportError && <FormAlert>{a.exportFailed}</FormAlert>}
      {log.isPending && <p role="status">{t.loading}</p>}
      {log.isError && (
        <FormAlert>
          {log.error instanceof ApiError && log.error.status === 422
            ? log.error.message
            : t.errors.generic}
        </FormAlert>
      )}
      {log.isSuccess && items.length === 0 && <p>{a.none}</p>}
      {items.length > 0 && <AuditEntries items={items} />}
      {log.hasNextPage && (
        <button
          type="button"
          className="rounded-md border border-slate-400 px-4 py-2"
          disabled={log.isFetchingNextPage}
          onClick={() => void log.fetchNextPage()}
        >
          {a.more}
        </button>
      )}
    </div>
  );
}
