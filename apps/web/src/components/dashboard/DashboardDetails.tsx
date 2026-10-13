import { formatUsd, parseCents } from '@govserve/shared';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { downloadReport, useMovements, useReportApplications } from '../../api/reports';
import { t } from '../../strings';
import { FormAlert } from '../form';

const d = t.dashboard;
const c = d.details.columns;
const at = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Mogadishu' }) : '—';

/** Only report filters (no personal data) are read from the URL. */
const KEYS = [
  'from',
  'to',
  'departmentId',
  'service',
  'channel',
  'kind',
  'status',
  'view',
] as const;

function MoreButton({
  show,
  busy,
  onClick,
}: {
  show: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  if (!show) return null;
  return (
    <button
      type="button"
      className="rounded-md border border-slate-400 px-4 py-2"
      disabled={busy}
      onClick={onClick}
    >
      {d.details.more}
    </button>
  );
}

function Movements({
  params,
  reviewBase,
}: {
  params: Record<string, string | undefined>;
  reviewBase: string | null;
}) {
  const list = useMovements(params);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      {list.isError && <FormAlert>{t.errors.generic}</FormAlert>}
      {list.isSuccess && items.length === 0 && <p>{d.details.none}</p>}
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm" data-testid="drilldown">
            <thead className="border-b border-slate-300">
              <tr>
                {[c.date, c.kind, c.reference, c.service, c.method, c.amount].map((h) => (
                  <th key={h} scope="col" className="py-2 pr-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.eventId} className="border-b border-slate-200">
                  <td className="py-2 pr-4">{at(m.occurredAt)}</td>
                  <td className="py-2 pr-4">{d.details.movements[m.kind]}</td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {reviewBase ? (
                      <Link to={`${reviewBase}/${m.applicationId}`} className="underline">
                        {m.referenceNo}
                      </Link>
                    ) : (
                      m.referenceNo
                    )}
                  </td>
                  <td className="py-2 pr-4">{m.serviceName}</td>
                  <td className="py-2 pr-4">{t.payments.channels[m.channel] ?? m.channel}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {m.kind === 'CONFIRMED' ? '' : '−'}
                    {formatUsd(parseCents(m.amountCents))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MoreButton
        show={list.hasNextPage}
        busy={list.isFetchingNextPage}
        onClick={() => void list.fetchNextPage()}
      />
    </>
  );
}

function Applications({
  params,
  reviewBase,
}: {
  params: Record<string, string | undefined>;
  reviewBase: string | null;
}) {
  const list = useReportApplications(params);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      {list.isError && <FormAlert>{t.errors.generic}</FormAlert>}
      {list.isSuccess && items.length === 0 && <p>{d.details.none}</p>}
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm" data-testid="drilldown">
            <thead className="border-b border-slate-300">
              <tr>
                {[
                  c.reference,
                  c.service,
                  c.status,
                  c.submitted,
                  c.decided,
                  c.slaDue,
                  c.outstanding,
                ].map((h) => (
                  <th key={h} scope="col" className="py-2 pr-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-b border-slate-200">
                  <td className="py-2 pr-4 font-mono text-xs">
                    {reviewBase ? (
                      <Link to={`${reviewBase}/${a.id}`} className="underline">
                        {a.referenceNo}
                      </Link>
                    ) : (
                      a.referenceNo
                    )}
                  </td>
                  <td className="py-2 pr-4">{a.serviceName}</td>
                  <td className="py-2 pr-4">{t.review.statuses[a.status] ?? a.status}</td>
                  <td className="py-2 pr-4">{at(a.submittedAt)}</td>
                  <td className="py-2 pr-4">{at(a.decidedAt)}</td>
                  <td className="py-2 pr-4">{at(a.slaDueAt)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatUsd(parseCents(a.outstandingCents))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MoreButton
        show={list.hasNextPage}
        busy={list.isFetchingNextPage}
        onClick={() => void list.fetchNextPage()}
      />
    </>
  );
}

/** FR-121 drill-down: the filtered list behind a KPI, with CSV export. */
export function DashboardDetails({
  base,
  reviewBase,
}: {
  base: string;
  reviewBase: string | null;
}) {
  const [search] = useSearchParams();
  const [error, setError] = useState(false);
  const raw = Object.fromEntries(KEYS.map((k) => [k, search.get(k) ?? undefined]));
  const { view, ...rest } = raw;
  const movements = view === 'movements';
  const params = movements ? rest : { ...rest, view };
  const title = movements
    ? d.details.movements[rest.kind ?? 'all']
    : d.details.applications[view ?? 'submitted'];
  return (
    <div className="space-y-6">
      <p>
        <Link to={base} className="text-brand underline">
          ← {d.details.back}
        </Link>
      </p>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        <button
          type="button"
          className="rounded-md border border-slate-400 px-3 py-1 text-sm"
          onClick={() =>
            void downloadReport(movements ? 'movements' : 'applications', params).catch(() =>
              setError(true),
            )
          }
        >
          {d.export}
        </button>
      </div>
      {error && <FormAlert>{d.exportFailed}</FormAlert>}
      <p className="text-sm text-slate-700">
        {rest.from} – {rest.to}
      </p>
      {movements ? (
        <Movements params={params} reviewBase={reviewBase} />
      ) : (
        <Applications params={params} reviewBase={reviewBase} />
      )}
    </div>
  );
}
