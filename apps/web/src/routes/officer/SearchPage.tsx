import {
  ApplicationStatus,
  formatUsd,
  parseCents,
  PaymentChannels,
  PaymentStatus,
  type StaffApplicationSearch,
  type StaffPaymentSearch,
} from '@govserve/shared';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { useCatalogue } from '../../api/catalogue';
import { ApiError } from '../../api/client';
import {
  downloadSearchCsv,
  useStaffApplicationSearch,
  useStaffPaymentSearch,
} from '../../api/search';
import { FilterField } from '../../components/FilterField';
import { FormAlert } from '../../components/form';
import { t } from '../../strings';
import { dollarsToCents } from '../citizen/PaymentPanel';

const s = t.search;
const f = s.fields;
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Africa/Mogadishu' });
const button = 'rounded-md bg-brand px-4 py-2 font-semibold text-white';

type Tab = 'applications' | 'payments';
type AppFilters = Omit<StaffApplicationSearch, 'cursor'>;
type PayFilters = Omit<StaffPaymentSearch, 'cursor'>;

const APP_EMPTY = {
  referenceNo: '',
  receiptNo: '',
  certificateNo: '',
  name: '',
  nationalId: '',
  phone: '',
  status: '',
  service: '',
  from: '',
  to: '',
};
const PAY_EMPTY = {
  referenceNo: '',
  receiptNo: '',
  channel: '',
  status: '',
  minAmount: '',
  maxAmount: '',
  from: '',
  to: '',
};

const filled = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '')) as Partial<T>;

function errorText(err: unknown): string {
  if (err instanceof ApiError && Array.isArray(err.details)) {
    return (err.details as { path: string; message: string }[])
      .map((d) => `${f[d.path as keyof typeof f] ?? d.path}: ${d.message}`)
      .join(' · ');
  }
  return err instanceof ApiError ? err.message : t.errors.generic;
}

function ExportButton({ kind, filters }: { kind: Tab; filters: object }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-1">
      <button
        type="button"
        className="rounded-md border border-slate-400 px-4 py-2 font-semibold"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void downloadSearchCsv(kind, filters)
            .catch(() => setError(s.exportFailed))
            .finally(() => setBusy(false));
        }}
      >
        {s.export}
      </button>
      <p className="text-xs text-slate-600">{s.exportHint}</p>
      {error && <FormAlert>{error}</FormAlert>}
    </div>
  );
}

function ApplicationSearch({ supervisor }: { supervisor: boolean }) {
  const [draft, setDraft] = useState(APP_EMPTY);
  const [filters, setFilters] = useState<AppFilters | null>(null);
  const results = useStaffApplicationSearch(filters);
  const services = useCatalogue('');
  const items = results.data?.pages.flatMap((p) => p.items) ?? [];
  const set = (k: keyof typeof APP_EMPTY) => (v: string) => setDraft({ ...draft, [k]: v });

  return (
    <div className="space-y-4">
      <form
        aria-label={s.tabs.applications}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setFilters(filled(draft) as AppFilters);
        }}
      >
        <FilterField
          label={f.referenceNo}
          value={draft.referenceNo}
          onChange={set('referenceNo')}
        />
        <FilterField label={f.receiptNo} value={draft.receiptNo} onChange={set('receiptNo')} />
        <FilterField
          label={f.certificateNo}
          value={draft.certificateNo}
          onChange={set('certificateNo')}
        />
        <FilterField label={f.name} value={draft.name} onChange={set('name')} />
        <FilterField label={f.nationalId} value={draft.nationalId} onChange={set('nationalId')} />
        <FilterField label={f.phone} value={draft.phone} onChange={set('phone')} />
        <FilterField
          label={f.status}
          type="select"
          anyLabel={s.any}
          value={draft.status}
          onChange={set('status')}
          options={Object.values(ApplicationStatus)
            .filter((x) => x !== 'DRAFT')
            .map((x) => [x, t.review.statuses[x] ?? x])}
        />
        <FilterField
          label={f.service}
          type="select"
          anyLabel={s.any}
          value={draft.service}
          onChange={set('service')}
          options={(services.data ?? []).map((x) => [x.code, x.name])}
        />
        <FilterField label={f.from} type="date" value={draft.from} onChange={set('from')} />
        <FilterField label={f.to} type="date" value={draft.to} onChange={set('to')} />
        <div className="flex items-end gap-3">
          <button type="submit" className={button}>
            {s.submit}
          </button>
          <button
            type="button"
            className="underline"
            onClick={() => {
              setDraft(APP_EMPTY);
              setFilters(null);
            }}
          >
            {s.clear}
          </button>
        </div>
      </form>
      {filters && supervisor && <ExportButton kind="applications" filters={filters} />}
      {results.isFetching && !results.isFetchingNextPage && <p role="status">{t.loading}</p>}
      {results.isError && <FormAlert>{errorText(results.error)}</FormAlert>}
      {results.isSuccess && items.length === 0 && <p>{s.noMatches}</p>}
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table
            className="w-full min-w-[48rem] text-left text-sm"
            data-testid="application-results"
          >
            <thead className="border-b border-slate-300">
              <tr>
                {[
                  s.columns.reference,
                  s.columns.service,
                  s.columns.applicant,
                  s.columns.subject,
                  s.columns.status,
                  s.columns.assignee,
                  s.columns.date,
                ].map((c) => (
                  <th key={c} scope="col" className="py-2 pr-4">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-b border-slate-200">
                  <td className="py-2 pr-4 font-mono text-xs">
                    <Link to={`/officer/review/${i.id}`} className="text-brand underline">
                      {i.referenceNo}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{i.serviceName}</td>
                  <td className="py-2 pr-4">{i.applicantName}</td>
                  <td className="py-2 pr-4">{i.subjectName}</td>
                  <td className="py-2 pr-4">{t.review.statuses[i.status] ?? i.status}</td>
                  <td className="py-2 pr-4">{i.assigneeName ?? t.review.unassigned}</td>
                  <td className="py-2 pr-4">{day(i.submittedAt ?? i.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {results.hasNextPage && (
        <button
          type="button"
          className="rounded-md border border-slate-400 px-4 py-2"
          disabled={results.isFetchingNextPage}
          onClick={() => void results.fetchNextPage()}
        >
          {s.more}
        </button>
      )}
    </div>
  );
}

function PaymentSearch({ supervisor }: { supervisor: boolean }) {
  const [draft, setDraft] = useState(PAY_EMPTY);
  const [filters, setFilters] = useState<PayFilters | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const results = useStaffPaymentSearch(filters);
  const items = results.data?.pages.flatMap((p) => p.items) ?? [];
  const set = (k: keyof typeof PAY_EMPTY) => (v: string) => setDraft({ ...draft, [k]: v });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { minAmount, maxAmount, ...rest } = draft;
    // Dollars to integer cents without floating point (never Number() on money).
    const minCents = minAmount ? dollarsToCents(minAmount) : undefined;
    const maxCents = maxAmount ? dollarsToCents(maxAmount) : undefined;
    if (minCents === null || maxCents === null) {
      setAmountError(s.badAmount);
      return;
    }
    setAmountError(null);
    setFilters({
      ...(filled(rest) as PayFilters),
      ...(minCents && { minCents }),
      ...(maxCents && { maxCents }),
    });
  };

  return (
    <div className="space-y-4">
      <form
        aria-label={s.tabs.payments}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={submit}
      >
        <FilterField
          label={f.referenceNo}
          value={draft.referenceNo}
          onChange={set('referenceNo')}
        />
        <FilterField label={f.receiptNo} value={draft.receiptNo} onChange={set('receiptNo')} />
        <FilterField
          label={f.channel}
          type="select"
          anyLabel={s.any}
          value={draft.channel}
          onChange={set('channel')}
          options={PaymentChannels.map((c) => [c, t.payments.channels[c] ?? c])}
        />
        <FilterField
          label={f.status}
          type="select"
          anyLabel={s.any}
          value={draft.status}
          onChange={set('status')}
          options={Object.values(PaymentStatus).map((x) => [x, t.payments.statuses[x] ?? x])}
        />
        <FilterField label={f.minAmount} value={draft.minAmount} onChange={set('minAmount')} />
        <FilterField label={f.maxAmount} value={draft.maxAmount} onChange={set('maxAmount')} />
        <FilterField label={f.from} type="date" value={draft.from} onChange={set('from')} />
        <FilterField label={f.to} type="date" value={draft.to} onChange={set('to')} />
        <div className="flex items-end gap-3">
          <button type="submit" className={button}>
            {s.submit}
          </button>
          <button
            type="button"
            className="underline"
            onClick={() => {
              setDraft(PAY_EMPTY);
              setFilters(null);
              setAmountError(null);
            }}
          >
            {s.clear}
          </button>
        </div>
      </form>
      {amountError && <FormAlert>{amountError}</FormAlert>}
      {filters && supervisor && <ExportButton kind="payments" filters={filters} />}
      {results.isFetching && !results.isFetchingNextPage && <p role="status">{t.loading}</p>}
      {results.isError && <FormAlert>{errorText(results.error)}</FormAlert>}
      {results.isSuccess && items.length === 0 && <p>{s.noMatches}</p>}
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left text-sm" data-testid="payment-results">
            <thead className="border-b border-slate-300">
              <tr>
                {[
                  s.columns.receipt,
                  s.columns.reference,
                  s.columns.applicant,
                  s.columns.method,
                  s.columns.amount,
                  s.columns.status,
                  s.columns.date,
                ].map((c) => (
                  <th key={c} scope="col" className="py-2 pr-4">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-b border-slate-200">
                  <td className="py-2 pr-4 font-mono text-xs">{p.receiptNo ?? '—'}</td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    <Link
                      to={`/officer/review/${p.applicationId}`}
                      className="text-brand underline"
                    >
                      {p.referenceNo}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{p.applicantName}</td>
                  <td className="py-2 pr-4">{t.payments.channels[p.channel]}</td>
                  <td className="py-2 pr-4">{formatUsd(parseCents(p.amountCents))}</td>
                  <td className="py-2 pr-4">{t.payments.statuses[p.status] ?? p.status}</td>
                  <td className="py-2 pr-4">{day(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {results.hasNextPage && (
        <button
          type="button"
          className="rounded-md border border-slate-400 px-4 py-2"
          disabled={results.isFetchingNextPage}
          onClick={() => void results.fetchNextPage()}
        >
          {s.more}
        </button>
      )}
    </div>
  );
}

/** FR-111/FR-112: department-scoped search; supervisors can export. */
export function SearchPage() {
  const auth = useAuth();
  const supervisor = auth.status === 'authenticated' && auth.user.role === 'SUPERVISOR';
  const [tab, setTab] = useState<Tab>('applications');
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{s.heading}</h1>
      <p className="text-slate-700">{s.intro}</p>
      <div role="tablist" aria-label={s.heading} className="flex gap-2 border-b border-slate-300">
        {(['applications', 'payments'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={`px-4 py-2 ${tab === k ? 'border-b-4 border-brand font-semibold' : ''}`}
            onClick={() => setTab(k)}
          >
            {s.tabs[k]}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'applications' ? (
          <ApplicationSearch supervisor={supervisor} />
        ) : (
          <PaymentSearch supervisor={supervisor} />
        )}
      </div>
    </div>
  );
}
