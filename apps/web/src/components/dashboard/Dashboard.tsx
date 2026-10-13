import {
  type CollectionsReport,
  formatUsd,
  parseCents,
  PaymentChannels,
  type PendingWorkReport,
  type ReportDataset,
} from '@govserve/shared';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { useCatalogue } from '../../api/catalogue';
import {
  downloadReport,
  type ReportParams,
  reportQuery,
  useCollections,
  usePendingWork,
  useReportSummary,
  useVolumes,
} from '../../api/reports';
import { t } from '../../strings';
import { FilterField } from '../FilterField';
import { FormAlert } from '../form';
import { CollectionsChart, VolumesChart } from './Charts';
import { type Column, SortableTable } from './SortableTable';

const d = t.dashboard;
const money = (cents: string) => formatUsd(parseCents(cents));
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Africa/Mogadishu' }) : d.kpis.none;

function Kpi({
  label,
  value,
  hint,
  to,
  testId,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  to?: string;
  testId: string;
}) {
  return (
    <div className="rounded-lg border border-slate-300 p-4" data-testid={testId}>
      <p className="text-sm text-slate-600">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-slate-600">{hint}</p>}
      {to && (
        <Link to={to} className="text-sm text-brand underline">
          {d.kpis.details}
          <span className="sr-only">: {label}</span>
        </Link>
      )}
    </div>
  );
}

function ExportButton({ dataset, params }: { dataset: ReportDataset; params: ReportParams }) {
  const [error, setError] = useState(false);
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        className="rounded-md border border-slate-400 px-3 py-1 text-sm"
        onClick={() => void downloadReport(dataset, params).catch(() => setError(true))}
      >
        {d.export}
      </button>
      {error && <span className="text-sm text-red-800">{d.exportFailed}</span>}
    </span>
  );
}

const moneyColumns = (
  first: Column<CollectionsReport['rows'][number]>,
): Column<CollectionsReport['rows'][number]>[] => [
  first,
  ...(['confirmed', 'refunded', 'reversed', 'net'] as const).map((k) => ({
    key: k,
    label: d.tables[k],
    numeric: true,
    sort: (r: CollectionsReport['rows'][number]) => parseCents(r[`${k}Cents`]),
    render: (r: CollectionsReport['rows'][number]) => money(r[`${k}Cents`]),
  })),
];

const officerColumns: Column<PendingWorkReport['officers'][number]>[] = [
  {
    key: 'officer',
    label: d.tables.officer,
    sort: (r) => r.officerName,
    render: (r) => r.officerName,
  },
  {
    key: 'department',
    label: d.tables.department,
    sort: (r) => r.departmentName,
    render: (r) => r.departmentName,
  },
  {
    key: 'assigned',
    label: d.tables.assigned,
    numeric: true,
    sort: (r) => r.assigned,
    render: (r) => r.assigned,
  },
  {
    key: 'oldest',
    label: d.tables.oldest,
    sort: (r) => r.oldestSince,
    render: (r) => when(r.oldestSince),
  },
];

const departmentColumns: Column<PendingWorkReport['departments'][number]>[] = [
  {
    key: 'department',
    label: d.tables.department,
    sort: (r) => r.departmentName,
    render: (r) => r.departmentName,
  },
  {
    key: 'queued',
    label: d.tables.queued,
    numeric: true,
    sort: (r) => r.queued,
    render: (r) => r.queued,
  },
  {
    key: 'overdue',
    label: d.tables.overdue,
    numeric: true,
    sort: (r) => r.overdue,
    render: (r) => r.overdue,
  },
  {
    key: 'oldest',
    label: d.tables.oldest,
    sort: (r) => r.oldestQueuedAt,
    render: (r) => when(r.oldestQueuedAt),
  },
];

/**
 * FR-120 dashboard. Every number comes from /reports (aggregated in SQL); the browser only formats.
 * `base` is the route prefix for drill-down links (officer or admin area).
 */
export function Dashboard({ admin, base }: { admin: boolean; base: string }) {
  const [draft, setDraft] = useState({
    from: '',
    to: '',
    departmentId: '',
    service: '',
    channel: '',
  });
  const [params, setParams] = useState<ReportParams>({});
  const summary = useReportSummary(params);
  const byDay = useCollections(params, 'day');
  const byService = useCollections(params, 'service');
  const byChannel = useCollections(params, 'channel');
  const volumes = useVolumes(params);
  const pending = usePendingWork(params);
  // Admins pick a department from the unfiltered department list.
  const allDepartments = usePendingWork({});
  const services = useCatalogue('');
  const s = summary.data;
  const scope = s?.scope;
  const scoped = scope
    ? {
        from: scope.from,
        to: scope.to,
        ...(scope.departmentId && admin && { departmentId: scope.departmentId }),
        ...(scope.service && { service: scope.service }),
        ...(scope.channel && { channel: scope.channel }),
      }
    : {};
  const drill = (extra: Record<string, string>) =>
    `${base}/details${reportQuery({ ...scoped, ...extra })}`;
  const set = (k: keyof typeof draft) => (v: string) => setDraft({ ...draft, [k]: v });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">{d.heading}</h1>
        {scope && (
          <p className="text-sm text-slate-700" data-testid="dashboard-scope">
            {scope.from} – {scope.to}
            {admin && !scope.departmentId ? ` · ${d.scopeAll}` : ''}
          </p>
        )}
      </div>

      <form
        aria-label={d.heading}
        className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setParams(Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== '')));
        }}
      >
        <FilterField label={d.filters.from} type="date" value={draft.from} onChange={set('from')} />
        <FilterField label={d.filters.to} type="date" value={draft.to} onChange={set('to')} />
        {admin && (
          <FilterField
            label={d.filters.department}
            type="select"
            anyLabel={d.filters.any}
            value={draft.departmentId}
            onChange={set('departmentId')}
            options={(allDepartments.data?.departments ?? []).map((x) => [
              x.departmentId,
              x.departmentName,
            ])}
          />
        )}
        <FilterField
          label={d.filters.service}
          type="select"
          anyLabel={d.filters.any}
          value={draft.service}
          onChange={set('service')}
          options={(services.data ?? []).map((x) => [x.code, x.name])}
        />
        <FilterField
          label={d.filters.channel}
          type="select"
          anyLabel={d.filters.any}
          value={draft.channel}
          onChange={set('channel')}
          options={PaymentChannels.map((c) => [c, t.payments.channels[c] ?? c])}
        />
        <div className="flex items-end">
          <button type="submit" className="rounded-md bg-brand px-4 py-2 font-semibold text-white">
            {d.filters.apply}
          </button>
        </div>
      </form>

      {summary.isPending && <p role="status">{t.loading}</p>}
      {summary.isError && <FormAlert>{t.errors.generic}</FormAlert>}

      {s && (
        <section aria-label={d.heading} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            testId="kpi-net"
            label={d.kpis.net}
            hint={d.kpis.netHint}
            value={money(s.collections.netCents)}
            to={drill({ view: 'movements' })}
          />
          <Kpi
            testId="kpi-confirmed"
            label={d.kpis.confirmed}
            value={money(s.collections.confirmedCents)}
            to={drill({ view: 'movements', kind: 'CONFIRMED' })}
          />
          <Kpi
            testId="kpi-refunded"
            label={d.kpis.refunded}
            value={money(s.collections.refundedCents)}
            to={drill({ view: 'movements', kind: 'REFUNDED' })}
          />
          <Kpi
            testId="kpi-reversed"
            label={d.kpis.reversed}
            value={money(s.collections.reversedCents)}
            to={drill({ view: 'movements', kind: 'REVERSED' })}
          />
          <Kpi
            testId="kpi-outstanding"
            label={d.kpis.outstanding}
            value={money(s.outstandingCents)}
            to={drill({ view: 'outstanding' })}
          />
          <Kpi
            testId="kpi-submitted"
            label={d.kpis.submitted}
            value={s.byStatus.reduce((n, b) => n + b.count, 0)}
            hint={s.byStatus
              .map((b) => `${t.review.statuses[b.status] ?? b.status}: ${b.count}`)
              .join(' · ')}
            to={drill({ view: 'submitted' })}
          />
          <Kpi
            testId="kpi-processing"
            label={d.kpis.median}
            value={
              s.processing.medianHours === null
                ? d.kpis.none
                : d.kpis.hours(s.processing.medianHours)
            }
            hint={
              s.processing.p90Hours === null
                ? undefined
                : `${d.kpis.p90}: ${d.kpis.hours(s.processing.p90Hours)}`
            }
            to={drill({ view: 'decided' })}
          />
          <Kpi
            testId="kpi-sla"
            label={d.kpis.sla}
            value={s.sla.compliancePct === null ? d.kpis.none : `${s.sla.compliancePct}%`}
            hint={`${d.kpis.slaOf(s.sla.onTime, s.sla.measured)} · ${d.kpis.overdue}: ${s.sla.overdue}`}
            to={drill({ view: 'overdue' })}
          />
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        {byDay.data && (
          <div className="space-y-2">
            <CollectionsChart report={byDay.data} />
            <details>
              <summary className="cursor-pointer text-sm underline">{d.charts.asTable}</summary>
              <SortableTable
                caption={d.charts.collections}
                rows={byDay.data.rows}
                rowKey={(r) => r.key}
                columns={moneyColumns({
                  key: 'day',
                  label: d.tables.day,
                  sort: (r) => r.key,
                  render: (r) => r.label,
                })}
              />
            </details>
          </div>
        )}
        {volumes.data && (
          <div className="space-y-2">
            <VolumesChart report={volumes.data} />
            <details>
              <summary className="cursor-pointer text-sm underline">{d.charts.asTable}</summary>
              <SortableTable
                caption={d.charts.volumes}
                rows={volumes.data.weeks}
                rowKey={(w) => w.weekStart}
                columns={[
                  {
                    key: 'week',
                    label: d.tables.week,
                    sort: (w) => w.weekStart,
                    render: (w) => w.weekStart,
                  },
                  {
                    key: 'submitted',
                    label: d.charts.submitted,
                    numeric: true,
                    sort: (w) => w.submitted,
                    render: (w) => w.submitted,
                  },
                  {
                    key: 'completed',
                    label: d.charts.completed,
                    numeric: true,
                    sort: (w) => w.completed,
                    render: (w) => w.completed,
                  },
                ]}
              />
            </details>
            <ExportButton dataset="volumes" params={params} />
          </div>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {byService.data && (
          <SortableTable
            testId="collections-by-service"
            caption={d.tables.byService}
            rows={byService.data.rows}
            rowKey={(r) => r.key}
            columns={moneyColumns({
              key: 'service',
              label: d.tables.service,
              sort: (r) => r.label,
              render: (r) => r.label,
            })}
          />
        )}
        {byChannel.data && (
          <SortableTable
            testId="collections-by-channel"
            caption={d.tables.byChannel}
            rows={byChannel.data.rows}
            rowKey={(r) => r.key}
            columns={moneyColumns({
              key: 'channel',
              label: d.tables.channel,
              sort: (r) => r.label,
              render: (r) => t.payments.channels[r.key] ?? r.key,
            })}
          />
        )}
      </div>
      <ExportButton dataset="collections" params={params} />

      {pending.data && (
        <div className="grid gap-8 lg:grid-cols-2">
          <SortableTable
            caption={d.tables.departments}
            rows={pending.data.departments}
            rowKey={(r) => r.departmentId}
            columns={departmentColumns}
          />
          <SortableTable
            testId="officers"
            caption={d.tables.officers}
            rows={pending.data.officers}
            rowKey={(r) => r.officerId}
            columns={officerColumns}
          />
        </div>
      )}
      <ExportButton dataset="pending-work" params={params} />
    </div>
  );
}
