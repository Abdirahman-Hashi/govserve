import { type ApplicationDetail, formatUsd, parseCents } from '@govserve/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  downloadTicket,
  useApplication,
  useDeleteApplication,
  useWithdrawApplication,
} from '../../api/applications';
import { ApiError } from '../../api/client';
import { FormAlert } from '../../components/form';
import { t } from '../../strings';
import { ApplicationWizard } from './ApplicationWizard';
import { StatusBadge } from './StatusBadge';

const a = t.applications;

function StatusView({ app }: { app: ApplicationDetail }) {
  const withdraw = useWithdrawApplication(app.id);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="max-w-2xl space-y-8">
      <p>
        <Link to="/citizen" className="text-brand underline">
          ← {a.detail.back}
        </Link>
      </p>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{app.serviceName}</h1>
        <StatusBadge status={app.status} />
        {app.referenceNo && (
          <p className="text-lg">
            {a.reference}:{' '}
            <span className="font-mono font-semibold" data-testid="reference">
              {app.referenceNo}
            </span>
          </p>
        )}
      </div>
      {error && <FormAlert>{error}</FormAlert>}

      {app.feeAssessment && (
        <section aria-labelledby="fee" className="space-y-2 rounded-lg border border-slate-300 p-4">
          <h2 id="fee" className="text-lg font-semibold">
            {a.detail.feeHeading}
          </h2>
          <dl className="space-y-1 text-sm">
            {app.feeAssessment.lines.map((l) => (
              <div key={l.code} className="flex justify-between">
                <dt>
                  {l.code === 'BASE'
                    ? t.catalogue.baseFee
                    : t.catalogue.copyLine(l.qty, formatUsd(parseCents(l.unitCents)))}
                </dt>
                <dd>{formatUsd(parseCents(l.amountCents))}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-slate-300 pt-1 font-semibold">
              <dt>{t.catalogue.total}</dt>
              <dd data-testid="assessed-total">
                {formatUsd(parseCents(app.feeAssessment.totalCents))}
              </dd>
            </div>
          </dl>
          {app.status === 'AWAITING_PAYMENT' && (
            <p className="text-sm text-slate-700">{a.detail.payNext}</p>
          )}
        </section>
      )}

      <section aria-labelledby="docs" className="space-y-2">
        <h2 id="docs" className="text-lg font-semibold">
          {a.detail.documents}
        </h2>
        <ul className="divide-y divide-slate-200 text-sm">
          {app.documents.map((d) => (
            <li key={d.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span>
                {app.requiredDocuments.find((r) => r.type === d.docType)?.label ?? d.docType} —{' '}
                {d.originalName}
              </span>
              {d.status === 'CLEAN' && (
                <button
                  type="button"
                  className="underline"
                  onClick={() =>
                    void downloadTicket(d.id)
                      .then((ticket) => window.open(ticket.url, '_blank', 'noopener'))
                      .catch(() => setError(t.errors.generic))
                  }
                >
                  {a.detail.download}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="timeline" className="space-y-2">
        <h2 id="timeline" className="text-lg font-semibold">
          {a.detail.timeline}
        </h2>
        <ol className="space-y-2 border-l-2 border-slate-300 pl-4">
          {app.history.map((h, i) => (
            <li key={i}>
              <p className="font-medium">{a.statuses[h.toStatus]}</p>
              <p className="text-sm text-slate-600">
                <time dateTime={h.at}>
                  {new Date(h.at).toLocaleString('en-GB', { timeZone: 'Africa/Mogadishu' })}
                </time>
                {h.note ? ` — ${h.note}` : ''}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {app.allowedActions.includes('WITHDRAW') &&
        (confirming ? (
          <div
            role="group"
            aria-label={a.detail.confirmWithdraw}
            className="space-y-2 rounded-md border border-slate-400 p-3"
          >
            <p>{a.detail.confirmWithdraw}</p>
            <div className="flex gap-3">
              <button
                type="button"
                className="rounded-md bg-red-800 px-4 py-2 font-semibold text-white"
                disabled={withdraw.isPending}
                onClick={() =>
                  withdraw.mutate(undefined, {
                    onSuccess: () => setConfirming(false),
                    onError: (err) =>
                      setError(err instanceof ApiError ? err.message : t.errors.generic),
                  })
                }
              >
                {a.detail.confirm}
              </button>
              <button type="button" className="underline" onClick={() => setConfirming(false)}>
                {a.detail.cancel}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="rounded-md border border-red-800 px-4 py-2 font-semibold text-red-800"
            onClick={() => setConfirming(true)}
          >
            {a.detail.withdraw}
          </button>
        ))}
    </div>
  );
}

function DeleteDraft({ id }: { id: string }) {
  const remove = useDeleteApplication(id);
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        className="text-sm text-red-800 underline"
        onClick={() => setConfirming(true)}
      >
        {a.detail.delete}
      </button>
    );
  }
  return (
    <div role="group" aria-label={a.detail.confirmDelete} className="space-y-2 text-sm">
      <p>{a.detail.confirmDelete}</p>
      <div className="flex gap-3">
        <button
          type="button"
          className="font-semibold text-red-800 underline"
          onClick={() => remove.mutate(undefined, { onSuccess: () => void navigate('/citizen') })}
        >
          {a.detail.confirm}
        </button>
        <button type="button" className="underline" onClick={() => setConfirming(false)}>
          {a.detail.cancel}
        </button>
      </div>
    </div>
  );
}

export function ApplicationPage() {
  const { id = '' } = useParams();
  const app = useApplication(id);
  if (app.isPending) return <p role="status">{t.loading}</p>;
  if (app.isError) return <FormAlert>{t.errors.generic}</FormAlert>;
  if (app.data.status === 'DRAFT') {
    return (
      <div className="space-y-6">
        {/* Remount when a different application opens so autosave state resets. */}
        <ApplicationWizard key={app.data.id} app={app.data} />
        <DeleteDraft id={app.data.id} />
      </div>
    );
  }
  return <StatusView app={app.data} />;
}
