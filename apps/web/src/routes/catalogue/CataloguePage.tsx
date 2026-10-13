import { formatUsd, parseCents } from '@govserve/shared';
import { type FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useCatalogue } from '../../api/catalogue';
import { FormAlert } from '../../components/form';
import { t } from '../../strings';

export function CataloguePage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [draft, setDraft] = useState(q);
  const services = useCatalogue(q);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setParams(draft.trim() ? { q: draft.trim() } : {});
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t.catalogue.heading}</h1>
      <p className="text-slate-700">{t.catalogue.intro}</p>
      <form role="search" onSubmit={submit} className="flex gap-2">
        <label htmlFor="catalogue-q" className="sr-only">
          {t.catalogue.search}
        </label>
        <input
          id="catalogue-q"
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t.catalogue.search}
          className="min-w-0 flex-1 rounded-md border border-slate-400 px-3 py-2"
        />
        <button type="submit" className="rounded-md bg-brand px-4 py-2 font-semibold text-white">
          {t.catalogue.searchButton}
        </button>
      </form>
      {services.isError && <FormAlert>{t.errors.generic}</FormAlert>}
      {services.data?.length === 0 && <p>{t.catalogue.empty}</p>}
      <ul className="grid gap-4 sm:grid-cols-2">
        {services.data?.map((s) => (
          <li key={s.code} className="rounded-lg border border-slate-300 p-4">
            <h2 className="text-lg font-semibold">
              <Link to={`/services/${s.code}`} className="text-brand underline">
                {s.name}
              </Link>
            </h2>
            <p className="mt-1 text-sm text-slate-700">{s.description}</p>
            <p className="mt-2 text-sm">
              {t.catalogue.from(formatUsd(parseCents(s.fee.baseCents)))} ·{' '}
              {t.catalogue.days(s.slaWorkingDays)}
              {s.feeProvisional && (
                <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                  {t.catalogue.provisionalShort}
                </span>
              )}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
