import { ApplicationStatus, type MyApplicationsQuery } from '@govserve/shared';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { useCatalogue } from '../../api/catalogue';
import { ApiError } from '../../api/client';
import { useMyApplications } from '../../api/search';
import { FilterField } from '../../components/FilterField';
import { FormAlert } from '../../components/form';
import { t } from '../../strings';
import { StatusBadge } from './StatusBadge';

const a = t.applications;
const hst = t.history;
const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Africa/Mogadishu' });

type Filters = Omit<MyApplicationsQuery, 'cursor'>;
const EMPTY = { status: '', service: '', from: '', to: '', q: '' };

/** FR-110: the citizen's applications, newest first, with filters and "show more". */
export function CitizenHome() {
  const [draft, setDraft] = useState(EMPTY);
  const [filters, setFilters] = useState<Filters>({});
  const apps = useMyApplications(filters);
  const services = useCatalogue('');
  const items = apps.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = Object.keys(filters).length > 0;

  const apply = (e: FormEvent) => {
    e.preventDefault();
    setFilters(Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== '')));
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{a.myHeading}</h1>
      <Link
        to="/services"
        className="inline-block rounded-md bg-brand px-4 py-2 font-semibold text-white"
      >
        {a.browse}
      </Link>
      <details className="rounded-lg border border-slate-300 p-3" open={filtered}>
        <summary className="cursor-pointer font-semibold">{hst.filters}</summary>
        <form onSubmit={apply} className="mt-3 grid gap-3 sm:grid-cols-2" aria-label={hst.filters}>
          <FilterField
            label={hst.status}
            type="select"
            anyLabel={hst.any}
            value={draft.status}
            onChange={(status) => setDraft({ ...draft, status })}
            options={Object.values(ApplicationStatus).map((s) => [s, a.statuses[s] ?? s])}
          />
          <FilterField
            label={hst.service}
            type="select"
            anyLabel={hst.any}
            value={draft.service}
            onChange={(service) => setDraft({ ...draft, service })}
            options={(services.data ?? []).map((s) => [s.code, s.name])}
          />
          <FilterField
            label={hst.from}
            type="date"
            value={draft.from}
            onChange={(from) => setDraft({ ...draft, from })}
          />
          <FilterField
            label={hst.to}
            type="date"
            value={draft.to}
            onChange={(to) => setDraft({ ...draft, to })}
          />
          <FilterField
            label={hst.reference}
            value={draft.q}
            onChange={(q) => setDraft({ ...draft, q })}
          />
          <div className="flex items-end gap-3">
            <button
              type="submit"
              className="rounded-md bg-brand px-4 py-2 font-semibold text-white"
            >
              {hst.apply}
            </button>
            <button
              type="button"
              className="underline"
              onClick={() => {
                setDraft(EMPTY);
                setFilters({});
              }}
            >
              {hst.clear}
            </button>
          </div>
        </form>
      </details>
      {apps.isPending && <p role="status">{t.loading}</p>}
      {apps.isError && (
        <FormAlert>
          {apps.error instanceof ApiError && apps.error.status === 422
            ? `${hst.invalid}${apps.error.message}`
            : t.errors.generic}
        </FormAlert>
      )}
      {apps.isSuccess && items.length === 0 && <p>{filtered ? hst.noMatches : a.none}</p>}
      <ul className="space-y-3" data-testid="my-applications">
        {items.map((app) => (
          <li key={app.id} className="rounded-lg border border-slate-300 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link
                to={`/citizen/applications/${app.id}`}
                className="font-semibold text-brand underline"
              >
                {app.serviceName}
              </Link>
              <StatusBadge status={app.status} />
            </div>
            <p className="mt-1 text-sm text-slate-700">
              {app.referenceNo ? `${a.reference}: ${app.referenceNo} · ` : ''}
              {app.submittedAt
                ? `${a.submitted} ${date(app.submittedAt)}`
                : `${a.started} ${date(app.createdAt)}`}
            </p>
            {app.status === 'DRAFT' && (
              <Link
                to={`/citizen/applications/${app.id}`}
                className="mt-2 inline-block text-sm underline"
              >
                {a.continueDraft}
              </Link>
            )}
          </li>
        ))}
      </ul>
      {apps.hasNextPage && (
        <button
          type="button"
          className="rounded-md border border-slate-400 px-4 py-2"
          disabled={apps.isFetchingNextPage}
          onClick={() => void apps.fetchNextPage()}
        >
          {hst.more}
        </button>
      )}
    </div>
  );
}
