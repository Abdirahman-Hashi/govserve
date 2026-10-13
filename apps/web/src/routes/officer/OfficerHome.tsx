import { type QueueQuery } from '@govserve/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '../../api/client';
import { useClaimNext, useReviewQueue } from '../../api/review';
import { FormAlert } from '../../components/form';
import { t } from '../../strings';

const r = t.review;
const VIEWS: Record<string, QueueQuery> = {
  QUEUED: {},
  mine: { assignee: 'me' },
  AWAITING_SUPERVISOR: { status: 'AWAITING_SUPERVISOR' },
  AWAITING_APPOINTMENT: { status: 'AWAITING_APPOINTMENT' },
  CORRECTION_REQUESTED: { status: 'CORRECTION_REQUESTED' },
};
const RISK_STYLE: Record<string, string> = {
  OVERDUE: 'bg-red-100 text-red-900',
  AT_RISK: 'bg-amber-100 text-amber-900',
  PAUSED: 'bg-slate-100 text-slate-800',
  ON_TRACK: 'bg-green-100 text-green-900',
  NONE: '',
};

/** FR-070: the department work queue, most urgent first. */
export function OfficerHome() {
  const [view, setView] = useState('QUEUED');
  const queue = useReviewQueue(VIEWS[view]!);
  const claimNext = useClaimNext();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{r.queueHeading}</h1>
        <button
          type="button"
          className="rounded-md bg-brand px-4 py-2 font-semibold text-white"
          disabled={claimNext.isPending}
          onClick={() =>
            claimNext.mutate(undefined, {
              onSuccess: (app) => void navigate(`/officer/review/${app.id}`),
              onError: (err) =>
                setError(
                  err instanceof ApiError && err.status === 404 ? r.queueEmpty : t.errors.generic,
                ),
            })
          }
        >
          {r.claimNext}
        </button>
      </div>
      {error && <FormAlert>{error}</FormAlert>}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="queue-view" className="text-sm font-medium">
          {r.filters.label}
        </label>
        <select
          id="queue-view"
          value={view}
          onChange={(e) => setView(e.target.value)}
          className="rounded-md border border-slate-400 px-3 py-2"
        >
          {Object.keys(VIEWS).map((k) => (
            <option key={k} value={k}>
              {r.filters[k]}
            </option>
          ))}
        </select>
      </div>
      {queue.isPending && <p role="status">{t.loading}</p>}
      {queue.isError && <FormAlert>{t.errors.generic}</FormAlert>}
      {queue.data?.length === 0 && <p>{r.empty}</p>}
      {queue.data && queue.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="border-b border-slate-300">
              <tr>
                {Object.values(r.columns).map((c) => (
                  <th key={c} scope="col" className="py-2 pr-4">
                    {c}
                  </th>
                ))}
                <th scope="col">
                  <span className="sr-only">{r.open}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {queue.data.map((i) => (
                <tr key={i.id} className="border-b border-slate-200">
                  <td className="py-2 pr-4 font-mono text-xs">{i.referenceNo}</td>
                  <td className="py-2 pr-4">{i.serviceName}</td>
                  <td className="py-2 pr-4">{i.applicantName}</td>
                  <td className="py-2 pr-4">{r.statuses[i.status]}</td>
                  <td className="py-2 pr-4">{i.assigneeName ?? r.unassigned}</td>
                  <td className="py-2 pr-4">
                    {i.slaDueAt
                      ? new Date(i.slaDueAt).toLocaleDateString('en-GB', {
                          timeZone: 'Africa/Mogadishu',
                        })
                      : '—'}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ${RISK_STYLE[i.slaRisk]}`}
                    >
                      {r.risks[i.slaRisk]}
                    </span>
                    {i.chargebackFlag && <span className="ml-1 text-xs text-red-800">⚠</span>}
                  </td>
                  <td className="py-2">
                    <Link to={`/officer/review/${i.id}`} className="text-brand underline">
                      {r.open}
                      <span className="sr-only">: {i.referenceNo}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
