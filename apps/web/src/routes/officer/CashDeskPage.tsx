import { type ApplicationLookup, formatUsd, parseCents } from '@govserve/shared';
import { type FormEvent, useState } from 'react';
import { ApiError } from '../../api/client';
import { lookupApplication, useRecordCash } from '../../api/payments';
import { FormAlert, SubmitButton, TextField } from '../../components/form';
import { t } from '../../strings';
import { dollarsToCents } from '../citizen/PaymentPanel';

const c = t.cashDesk;
const message = (err: unknown) => (err instanceof ApiError ? err.message : t.errors.generic);

export function CashDeskPage() {
  const record = useRecordCash();
  const [ref, setRef] = useState('');
  const [found, setFound] = useState<ApplicationLookup | null>(null);
  const [values, setValues] = useState({ amount: '', receiptBook: '', payer: '' });
  const [error, setError] = useState<string | null>(null);

  const find = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFound(null);
    record.reset();
    try {
      const app = await lookupApplication(ref.trim().toUpperCase());
      setFound(app);
      setValues({
        amount: formatUsd(parseCents(app.balanceCents)).slice(1),
        receiptBook: '',
        payer: app.applicantName,
      });
    } catch (err) {
      setError(message(err));
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const amountCents = dollarsToCents(values.amount);
    if (!amountCents || !found) return setError(t.payments.invalidAmount);
    record.mutate(
      {
        referenceNo: found.referenceNo,
        amountCents,
        receiptBookRef: values.receiptBook,
        payerName: values.payer,
      },
      { onError: (err) => setError(message(err)) },
    );
  };

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">{c.heading}</h1>
      <form noValidate onSubmit={(e) => void find(e)} className="flex flex-wrap items-end gap-3">
        <TextField
          label={c.referenceNo}
          name="ref"
          value={ref}
          placeholder="GS-2026-000123"
          onChange={(e) => setRef(e.target.value)}
        />
        <SubmitButton pending={false}>{c.find}</SubmitButton>
      </form>
      {error && <FormAlert>{error}</FormAlert>}
      {found && (
        <section className="space-y-4 rounded-lg border border-slate-300 p-4">
          <p className="font-semibold">
            {found.referenceNo} · {found.serviceName} · {found.applicantName}
          </p>
          <p className="text-lg font-semibold">
            {c.balance(formatUsd(parseCents(found.balanceCents)))}
          </p>
          {record.isSuccess ? (
            <FormAlert tone="success">
              {c.recorded(record.data.status)} {record.data.receiptNo ?? ''}
            </FormAlert>
          ) : (
            <form noValidate onSubmit={submit} className="space-y-3">
              <TextField
                label={c.amount}
                name="amount"
                inputMode="decimal"
                value={values.amount}
                onChange={(e) => setValues((v) => ({ ...v, amount: e.target.value }))}
              />
              <TextField
                label={c.receiptBook}
                name="receiptBook"
                value={values.receiptBook}
                onChange={(e) => setValues((v) => ({ ...v, receiptBook: e.target.value }))}
              />
              <TextField
                label={c.payer}
                name="payer"
                value={values.payer}
                onChange={(e) => setValues((v) => ({ ...v, payer: e.target.value }))}
              />
              <SubmitButton pending={record.isPending}>{c.record}</SubmitButton>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
