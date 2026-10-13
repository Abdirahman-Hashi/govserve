import { formatUsd, parseCents, RefundReasons, type StaffPaymentDto } from '@govserve/shared';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../../api/client';
import {
  downloadReceipt,
  staffDocumentTicket,
  useConfirmPayment,
  useRejectPayment,
  useRequestRefund,
  useStaffPayment,
  useStaffReasonCodes,
} from '../../api/payments';
import { useAuth } from '../../auth/AuthProvider';
import { FormAlert, SelectField, SubmitButton, TextField } from '../../components/form';
import { t } from '../../strings';
import { dollarsToCents } from '../citizen/PaymentPanel';

const o = t.officerPayments;
const message = (err: unknown) => (err instanceof ApiError ? err.message : t.errors.generic);

function RejectForm({ payment }: { payment: StaffPaymentDto }) {
  const reasons = useStaffReasonCodes('PAYMENT_REJECT');
  const reject = useRejectPayment();
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    reject.mutate(
      { id: payment.id, reasonCode: reasonCode || reasons.data?.[0]?.code || '', note },
      { onError: (err) => setError(message(err)) },
    );
  };
  return (
    <form noValidate onSubmit={submit} className="space-y-3 rounded-lg border border-slate-300 p-4">
      <h2 className="font-semibold">{o.rejectHeading}</h2>
      {error && <FormAlert>{error}</FormAlert>}
      {reject.isSuccess && <FormAlert tone="success">{o.rejected}</FormAlert>}
      <SelectField
        label={o.reason}
        name="reasonCode"
        value={reasonCode || reasons.data?.[0]?.code || ''}
        onChange={(e) => setReasonCode(e.target.value)}
        options={(reasons.data ?? []).map((r) => ({ value: r.code, label: r.label }))}
      />
      <TextField
        label={o.note}
        name="note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button
        type="submit"
        disabled={reject.isPending}
        className="rounded-md border border-red-800 px-4 py-2 font-semibold text-red-800"
      >
        {o.reject}
      </button>
    </form>
  );
}

function RefundForm({ payment }: { payment: StaffPaymentDto }) {
  const request = useRequestRefund();
  const [reason, setReason] = useState<string>(
    payment.overpaidCents !== '0' ? 'OVERPAYMENT' : 'DUPLICATE_PAYMENT',
  );
  const [amount, setAmount] = useState(
    formatUsd(
      parseCents(payment.overpaidCents !== '0' ? payment.overpaidCents : payment.amountCents),
    ).slice(1),
  );
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const amountCents = dollarsToCents(amount);
    if (!amountCents) return setError(t.payments.invalidAmount);
    request.mutate(
      { paymentId: payment.id, reason: reason as (typeof RefundReasons)[number], amountCents },
      { onError: (err) => setError(message(err)) },
    );
  };
  return (
    <form noValidate onSubmit={submit} className="space-y-3 rounded-lg border border-slate-300 p-4">
      <h2 className="font-semibold">{o.refundHeading}</h2>
      {error && <FormAlert>{error}</FormAlert>}
      {request.isSuccess && <FormAlert tone="success">{o.refundRequested}</FormAlert>}
      <SelectField
        label={o.refundReason}
        name="reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        options={RefundReasons.map((r) => ({ value: r, label: o.reasons[r] ?? r }))}
      />
      <TextField
        label={o.refundAmount}
        name="amount"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <SubmitButton pending={request.isPending}>{o.requestRefund}</SubmitButton>
    </form>
  );
}

export function PaymentReviewPage() {
  const { id = '' } = useParams();
  const payment = useStaffPayment(id);
  const confirm = useConfirmPayment();
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);
  if (payment.isPending) return <p role="status">{t.loading}</p>;
  if (payment.isError) return <FormAlert>{message(payment.error)}</FormAlert>;
  const p = payment.data;
  const me = auth.status === 'authenticated' ? auth.user : null;
  const canConfirm =
    p.channel !== 'CARD' &&
    (p.status === 'PENDING_VERIFICATION' ||
      (p.status === 'AWAITING_SUPERVISOR' &&
        me?.role === 'SUPERVISOR' &&
        me.id !== p.firstConfirmedById));

  return (
    <div className="max-w-2xl space-y-6">
      <p>
        <Link to="/officer/payments" className="text-brand underline">
          ← {o.back}
        </Link>
      </p>
      <h1 className="text-2xl font-bold">{o.detailHeading}</h1>
      {error && <FormAlert>{error}</FormAlert>}
      {confirm.isSuccess && (
        <FormAlert tone="success">
          {confirm.data.status === 'CONFIRMED' ? o.confirmed : o.sentToSupervisor}
        </FormAlert>
      )}
      {p.status === 'AWAITING_SUPERVISOR' && !canConfirm && (
        <FormAlert tone="success">{o.secondNeeded}</FormAlert>
      )}
      <dl className="divide-y divide-slate-200 rounded-lg border border-slate-300 text-sm">
        {(
          [
            [o.columns.applicant, p.applicantName],
            [o.columns.reference, p.applicationReferenceNo ?? '—'],
            [o.assessed, formatUsd(parseCents(p.assessedCents))],
            [o.columns.channel, t.payments.channels[p.channel]],
            [o.provider, p.provider],
            [o.transaction, p.reference],
            [o.columns.amount, formatUsd(parseCents(p.amountCents))],
            [
              o.paidAt,
              new Date(p.paidAt).toLocaleDateString('en-GB', { timeZone: 'Africa/Mogadishu' }),
            ],
            [o.columns.status, t.payments.statuses[p.status]],
            ...(p.payerName ? [[o.payer, p.payerName] as const] : []),
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="grid grid-cols-2 gap-2 p-3">
            <dt className="text-slate-600">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {p.evidenceDocumentId ? (
        <button
          type="button"
          className="underline"
          onClick={() =>
            void staffDocumentTicket(p.evidenceDocumentId!)
              .then((ticket) => window.open(ticket.url, '_blank', 'noopener'))
              .catch((err: unknown) => setError(message(err)))
          }
        >
          {o.evidence}
        </button>
      ) : (
        <p className="text-sm text-slate-600">{o.noEvidence}</p>
      )}
      {canConfirm && (
        <button
          type="button"
          disabled={confirm.isPending}
          onClick={() => confirm.mutate(p.id, { onError: (err) => setError(message(err)) })}
          className="rounded-md bg-brand px-5 py-3 font-semibold text-white"
        >
          {o.confirm}
        </button>
      )}
      {(p.status === 'PENDING_VERIFICATION' ||
        (p.status === 'AWAITING_SUPERVISOR' && me?.role === 'SUPERVISOR')) && (
        <RejectForm payment={p} />
      )}
      {p.status === 'CONFIRMED' && (
        <>
          {p.receiptNo && (
            <button
              type="button"
              className="underline"
              onClick={() =>
                void downloadReceipt(p.id, p.receiptNo!).catch((err: unknown) =>
                  setError(message(err)),
                )
              }
            >
              {t.payments.receipt} ({p.receiptNo})
            </button>
          )}
          <RefundForm payment={p} />
        </>
      )}
    </div>
  );
}
