import { formatUsd, parseCents, PayoutMethods, type RefundDto } from '@govserve/shared';
import { useState } from 'react';
import { ApiError } from '../../api/client';
import { useRefundAction, useRefunds } from '../../api/payments';
import { FormAlert, SelectField, TextField } from '../../components/form';
import { t } from '../../strings';

const r = t.refundsPage;

function RefundRow({ refund }: { refund: RefundDto }) {
  const act = useRefundAction();
  const [note, setNote] = useState('');
  const [payout, setPayout] = useState({ payoutMethod: 'MOBILE_MONEY', payoutReference: '' });
  const [error, setError] = useState<string | null>(null);
  const run = (action: 'approve' | 'decline' | 'complete' | 'retry', body?: object) =>
    act.mutate(
      { id: refund.id, action, ...(body && { body: body as never }) },
      { onError: (err) => setError(err instanceof ApiError ? err.message : t.errors.generic) },
    );

  return (
    <li className="space-y-3 rounded-lg border border-slate-300 p-4">
      <p className="font-semibold">
        {refund.applicationReferenceNo} · {formatUsd(parseCents(refund.amountCents))} ·{' '}
        {t.officerPayments.reasons[refund.reason]}
      </p>
      <p className="text-sm">{r.statuses[refund.status]}</p>
      {refund.note && <p className="text-sm text-slate-700">{refund.note}</p>}
      {error && <FormAlert>{error}</FormAlert>}
      {refund.status === 'REQUESTED' && (
        <div className="space-y-2">
          <button
            type="button"
            className="rounded-md bg-brand px-4 py-2 font-semibold text-white"
            onClick={() => run('approve')}
          >
            {r.approve}
          </button>
          <TextField
            label={r.declineNote}
            name={`decline-${refund.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="button" className="underline" onClick={() => run('decline', { note })}>
            {r.decline}
          </button>
        </div>
      )}
      {refund.status === 'APPROVED' && (
        <div className="grid gap-2 sm:grid-cols-3 sm:items-end">
          <SelectField
            label={r.payoutMethod}
            name={`method-${refund.id}`}
            value={payout.payoutMethod}
            onChange={(e) => setPayout((v) => ({ ...v, payoutMethod: e.target.value }))}
            options={PayoutMethods.filter((m) => m !== 'CARD').map((m) => ({
              value: m,
              label: t.payments.channels[m] ?? m,
            }))}
          />
          <TextField
            label={r.payoutReference}
            name={`ref-${refund.id}`}
            value={payout.payoutReference}
            onChange={(e) => setPayout((v) => ({ ...v, payoutReference: e.target.value }))}
          />
          <button
            type="button"
            className="rounded-md bg-brand px-4 py-2 font-semibold text-white"
            onClick={() => run('complete', payout)}
          >
            {r.complete}
          </button>
        </div>
      )}
      {refund.status === 'FAILED' && (
        <button type="button" className="underline" onClick={() => run('retry')}>
          {r.retry}
        </button>
      )}
    </li>
  );
}

export function RefundsPage() {
  const refunds = useRefunds();
  const open = refunds.data?.filter(
    (x) => x.status === 'REQUESTED' || x.status === 'APPROVED' || x.status === 'FAILED',
  );
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">{r.heading}</h1>
      {refunds.isPending && <p role="status">{t.loading}</p>}
      {refunds.isError && <FormAlert>{t.errors.generic}</FormAlert>}
      {open?.length === 0 && <p>{r.empty}</p>}
      <ul className="space-y-3">
        {open?.map((x) => (
          <RefundRow key={x.id} refund={x} />
        ))}
      </ul>
    </div>
  );
}
