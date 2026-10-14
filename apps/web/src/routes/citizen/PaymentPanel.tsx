import {
  type ApplicationDetail,
  formatUsd,
  MobileMoneyProviders,
  parseCents,
  type PaymentDto,
} from '@govserve/shared';
import { type FormEvent, useRef, useState } from 'react';
import { completeUpload } from '../../api/applications';
import { ApiError } from '../../api/client';
import {
  downloadReceipt,
  requestEvidenceUpload,
  startCardPayment,
  useSubmitManualPayment,
} from '../../api/payments';
import { FormAlert, SelectField, SubmitButton, TextField } from '../../components/form';
import { FileProblem, prepareFile, putWithProgress } from '../../files/prepare';
import { t } from '../../strings';

const p = t.payments;

/** "19" or "19.5" or "19.00" → "1900" cents, without floating point. Null if not a valid amount. */
export function dollarsToCents(input: string): string | null {
  const m = /^\s*\$?\s*(\d{1,9})(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!m) return null;
  const cents = BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
  return cents > 0n ? cents.toString() : null;
}

type Channel = 'MOBILE_MONEY' | 'BANK' | 'CARD' | 'CASH';

function ManualForm({
  app,
  channel,
}: {
  app: ApplicationDetail;
  channel: 'MOBILE_MONEY' | 'BANK';
}) {
  const submit = useSubmitManualPayment(app.id);
  const [values, setValues] = useState({
    provider: 'EVC_PLUS',
    bank: '',
    reference: '',
    amount: formatUsd(parseCents(app.balanceCents)).slice(1),
    paidAt: new Date().toISOString().slice(0, 10),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const file = useRef<File | null>(null);
  const set = (k: keyof typeof values) => ({
    name: k,
    id: `pay-${k}`,
    value: values[k],
    onChange: (e: { target: { value: string } }) =>
      setValues((v) => ({ ...v, [k]: e.target.value })),
    'aria-invalid': errors[k] ? true : undefined,
    'aria-describedby': errors[k] ? `${k}-error` : undefined,
  });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const amountCents = dollarsToCents(values.amount);
    if (!amountCents) return setErrors({ amount: p.invalidAmount });
    setErrors({});
    try {
      let evidenceDocumentId: string | undefined;
      if (file.current) {
        const prepared = await prepareFile(file.current, [
          'application/pdf',
          'image/jpeg',
          'image/png',
        ]);
        const ticket = await requestEvidenceUpload(app.id, {
          fileName: prepared.name,
          mime: prepared.mime,
          sizeBytes: prepared.blob.size,
          sha256: prepared.sha256,
        });
        await putWithProgress(ticket.uploadUrl, ticket.headers, prepared.blob, () => undefined);
        await completeUpload(ticket.document.id);
        evidenceDocumentId = ticket.document.id;
      }
      await submit.mutateAsync({
        channel,
        provider: channel === 'MOBILE_MONEY' ? values.provider : values.bank,
        reference: values.reference,
        amountCents,
        paidAt: values.paidAt,
        ...(evidenceDocumentId && { evidenceDocumentId }),
      });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(
          Object.fromEntries(
            Object.entries(err.fieldErrors()).map(([k, v]) => [
              k === 'provider' && channel === 'BANK' ? 'bank' : k,
              v,
            ]),
          ),
        );
        setFormError(err.message);
      } else
        setFormError(
          err instanceof FileProblem ? t.applications.docs.problems.wrongType : t.errors.generic,
        );
    }
  };

  if (done) return <FormAlert tone="success">{p.submitted}</FormAlert>;
  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="space-y-4">
      {formError && <FormAlert>{formError}</FormAlert>}
      {channel === 'MOBILE_MONEY' ? (
        <SelectField
          label={p.provider}
          options={MobileMoneyProviders.map((v) => ({
            value: v,
            label: p.mobileProviders[v] ?? v,
          }))}
          {...set('provider')}
        />
      ) : (
        <TextField label={p.bankName} error={errors['bank']} {...set('bank')} />
      )}
      <TextField
        label={channel === 'MOBILE_MONEY' ? p.reference : p.slipNumber}
        autoComplete="off"
        error={errors['reference']}
        {...set('reference')}
      />
      <TextField
        label={p.amount}
        hint={p.amountHint}
        inputMode="decimal"
        error={errors['amount'] ?? errors['amountCents']}
        {...set('amount')}
      />
      <TextField label={p.paidAt} type="date" error={errors['paidAt']} {...set('paidAt')} />
      <div>
        <label htmlFor="pay-evidence" className="block text-sm font-medium">
          {p.evidence}
        </label>
        <input
          id="pay-evidence"
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="mt-1 block w-full text-sm"
          onChange={(e) => (file.current = e.target.files?.[0] ?? null)}
        />
      </div>
      <SubmitButton pending={submit.isPending}>{p.submit}</SubmitButton>
    </form>
  );
}

function CardOption({ app }: { app: ApplicationDetail }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // One key per click; a retried network request reuses it so only one payment is started.
  const key = useRef<string>(crypto.randomUUID());
  const go = async () => {
    setPending(true);
    setError(null);
    try {
      const { checkoutUrl } = await startCardPayment(app.id, key.current);
      window.location.assign(checkoutUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.errors.generic);
      key.current = crypto.randomUUID();
      setPending(false);
    }
  };
  return (
    <div className="space-y-3">
      {error && <FormAlert>{error}</FormAlert>}
      <p className="text-sm text-slate-700">{p.cardIntro}</p>
      <button
        type="button"
        disabled={pending}
        onClick={() => void go()}
        className="rounded-md bg-brand px-4 py-3 font-semibold text-white"
      >
        {p.payByCard(formatUsd(parseCents(app.balanceCents)))}
      </button>
    </div>
  );
}

export function PaymentPanel({ app }: { app: ApplicationDetail }) {
  const [channel, setChannel] = useState<Channel>('MOBILE_MONEY');
  const returned = new URLSearchParams(window.location.search).get('card') === 'return';
  return (
    <section aria-labelledby="pay-h" className="space-y-4 rounded-lg border border-brand p-4">
      <h2 id="pay-h" className="text-lg font-semibold">
        {p.heading}
      </h2>
      <p className="text-lg font-semibold" data-testid="balance">
        {p.balance(formatUsd(parseCents(app.balanceCents)))}
      </p>
      {app.paidCents !== '0' && (
        <p className="text-sm">{p.paid(formatUsd(parseCents(app.paidCents)))}</p>
      )}
      {returned && <FormAlert tone="success">{p.cardReturned}</FormAlert>}
      <fieldset>
        <legend className="text-sm font-medium">{p.choose}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(['MOBILE_MONEY', 'BANK', 'CARD', 'CASH'] as const)
            .filter((c) => c !== 'CARD' || app.cardPaymentsEnabled)
            .map((c) => (
              <label
                key={c}
                className={`flex items-center gap-2 rounded-md border p-3 ${channel === c ? 'border-brand bg-blue-50' : 'border-slate-300'}`}
              >
                <input
                  type="radio"
                  name="channel"
                  value={c}
                  checked={channel === c}
                  onChange={() => setChannel(c)}
                  className="h-5 w-5"
                />
                {p.channels[c]}
              </label>
            ))}
        </div>
      </fieldset>
      {(channel === 'MOBILE_MONEY' || channel === 'BANK') && (
        <ManualForm key={channel} app={app} channel={channel} />
      )}
      {channel === 'CARD' && <CardOption app={app} />}
      {channel === 'CASH' && <p className="text-sm">{p.cashIntro(app.referenceNo ?? '')}</p>}
    </section>
  );
}

export function PaymentList({ payments }: { payments: PaymentDto[] }) {
  const [error, setError] = useState<string | null>(null);
  if (payments.length === 0) return null;
  return (
    <section aria-labelledby="payments-h" className="space-y-2">
      <h2 id="payments-h" className="text-lg font-semibold">
        {p.listHeading}
      </h2>
      {error && <FormAlert>{error}</FormAlert>}
      <ul className="divide-y divide-slate-200 text-sm">
        {payments.map((pay) => (
          <li key={pay.id} className="space-y-1 py-2">
            <div className="flex flex-wrap justify-between gap-2">
              <span>
                {p.channels[pay.channel]} · {formatUsd(parseCents(pay.amountCents))} ·{' '}
                {pay.reference}
              </span>
              <span className="font-medium">{p.statuses[pay.status]}</span>
            </div>
            {pay.rejectNote && <p className="text-red-800">✕ {pay.rejectNote}</p>}
            {pay.overpaidCents !== '0' && (
              <p className="text-slate-700">
                {p.overpaid(formatUsd(parseCents(pay.overpaidCents)))}
              </p>
            )}
            {pay.receiptNo && (
              <button
                type="button"
                className="underline"
                onClick={() =>
                  void downloadReceipt(pay.id, pay.receiptNo!).catch(() =>
                    setError(t.errors.generic),
                  )
                }
              >
                {p.receipt} ({pay.receiptNo})
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
