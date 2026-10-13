import { formatUsd, type MyPaymentsQuery, parseCents, PaymentStatus } from '@govserve/shared';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { downloadReceipt } from '../../api/payments';
import { useMyPayments } from '../../api/search';
import { FilterField } from '../../components/FilterField';
import { FormAlert } from '../../components/form';
import { t } from '../../strings';

const m = t.myPayments;
const hst = t.history;

type Filters = Omit<MyPaymentsQuery, 'cursor'>;
const EMPTY = { status: '', from: '', to: '', q: '' };

/** FR-110: payments and receipts across all of the citizen's applications. */
export function MyPaymentsPage() {
  const [draft, setDraft] = useState(EMPTY);
  const [filters, setFilters] = useState<Filters>({});
  const [error, setError] = useState<string | null>(null);
  const payments = useMyPayments(filters);
  const items = payments.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = Object.keys(filters).length > 0;

  const apply = (e: FormEvent) => {
    e.preventDefault();
    setFilters(Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== '')));
  };

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">{m.heading}</h1>
      <details className="rounded-lg border border-slate-300 p-3" open={filtered}>
        <summary className="cursor-pointer font-semibold">{hst.filters}</summary>
        <form onSubmit={apply} className="mt-3 grid gap-3 sm:grid-cols-2" aria-label={hst.filters}>
          <FilterField
            label={hst.status}
            type="select"
            anyLabel={hst.any}
            value={draft.status}
            onChange={(status) => setDraft({ ...draft, status })}
            options={Object.values(PaymentStatus).map((s) => [s, t.payments.statuses[s] ?? s])}
          />
          <FilterField
            label={hst.referenceOrReceipt}
            value={draft.q}
            onChange={(q) => setDraft({ ...draft, q })}
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
      {error && <FormAlert>{error}</FormAlert>}
      {payments.isPending && <p role="status">{t.loading}</p>}
      {payments.isError && <FormAlert>{t.errors.generic}</FormAlert>}
      {payments.isSuccess && items.length === 0 && <p>{filtered ? hst.noMatches : m.none}</p>}
      <ul className="space-y-3" data-testid="my-payments">
        {items.map((p) => (
          <li key={p.id} className="space-y-1 rounded-lg border border-slate-300 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">{formatUsd(parseCents(p.amountCents))}</span>
              <span className="text-sm">{t.payments.statuses[p.status] ?? p.status}</span>
            </div>
            <p className="text-sm text-slate-700">
              {t.payments.channels[p.channel]} ·{' '}
              {new Date(p.createdAt).toLocaleDateString('en-GB', { timeZone: 'Africa/Mogadishu' })}
            </p>
            <p className="text-sm">
              {m.application}:{' '}
              <Link to={`/citizen/applications/${p.applicationId}`} className="underline">
                {p.serviceName} {p.referenceNo}
              </Link>
            </p>
            {p.receiptNo && (
              <button
                type="button"
                className="text-sm font-semibold text-brand underline"
                onClick={() =>
                  void downloadReceipt(p.id, p.receiptNo!).catch(() => setError(m.downloadFailed))
                }
              >
                {m.download} ({p.receiptNo})
              </button>
            )}
          </li>
        ))}
      </ul>
      {payments.hasNextPage && (
        <button
          type="button"
          className="rounded-md border border-slate-400 px-4 py-2"
          disabled={payments.isFetchingNextPage}
          onClick={() => void payments.fetchNextPage()}
        >
          {hst.more}
        </button>
      )}
    </div>
  );
}
