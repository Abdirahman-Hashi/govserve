import { formatUsd, parseCents, type SignatureCheck, verifySignature } from '@govserve/shared';
import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router';
import { ApiError } from '../../api/client';
import { usePublicKeys, usePublicReceipt } from '../../api/payments';
import { FormAlert } from '../../components/form';
import { t } from '../../strings';

const v = t.verifyReceipt;

/**
 * Public receipt check (ADR-0006). The signature travels in the URL fragment (never sent to the
 * server) and is checked here against the published key; the status comes live from the API.
 */
export function VerifyReceiptPage() {
  const { receiptNo = '' } = useParams();
  const { hash } = useLocation();
  const sig = new URLSearchParams(hash.replace(/^#/, '')).get('sig');
  const receipt = usePublicReceipt(receiptNo);
  const keys = usePublicKeys();
  const [verified, setVerified] = useState<{ sig: string; result: SignatureCheck } | null>(null);
  const key = receipt.data && keys.data?.keys.find((k) => k.kid === receipt.data.payload.kid);

  useEffect(() => {
    if (!receipt.data || !key || !sig) return;
    let cancelled = false;
    void verifySignature(receipt.data.payload, sig, key.publicKey).then((result) => {
      if (!cancelled) setVerified({ sig, result });
    });
    return () => {
      cancelled = true;
    };
  }, [receipt.data, key, sig]);

  // Derived without effects: no signature in the link, or a key we do not publish.
  const check: SignatureCheck | 'MISSING' | null =
    !receipt.data || !keys.data
      ? null
      : !sig
        ? 'MISSING'
        : !key
          ? 'INVALID'
          : verified?.sig === sig
            ? verified.result
            : null;

  if (receipt.isPending) return <p role="status">{t.loading}</p>;
  if (receipt.isError) {
    return (
      <FormAlert>
        {receipt.error instanceof ApiError && receipt.error.status === 404
          ? v.notFound
          : t.errors.generic}
      </FormAlert>
    );
  }
  const r = receipt.data;
  const signature =
    check === 'VALID'
      ? { tone: 'success' as const, text: v.signatureOk }
      : check === 'INVALID'
        ? { tone: 'error' as const, text: v.signatureBad }
        : check === 'UNSUPPORTED'
          ? { tone: 'success' as const, text: v.signatureUnsupported }
          : check === 'MISSING'
            ? { tone: 'error' as const, text: v.signatureMissing }
            : null;

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-bold">{v.heading}</h1>
      <p
        className={`text-xl font-bold ${r.status === 'VALID' && check !== 'INVALID' ? 'text-green-800' : 'text-red-800'}`}
        data-testid="receipt-status"
      >
        <span aria-hidden="true">{r.status === 'VALID' && check !== 'INVALID' ? '✓ ' : '✕ '}</span>
        {v.status[r.status]}
      </p>
      {signature && <FormAlert tone={signature.tone}>{signature.text}</FormAlert>}
      <dl className="divide-y divide-slate-200 rounded-lg border border-slate-300 text-sm">
        {(
          [
            [v.fields.receiptNo, r.receiptNo],
            [v.fields.service, r.serviceName],
            [v.fields.amount, formatUsd(parseCents(r.amountCents))],
            [
              v.fields.date,
              new Date(r.issuedAt).toLocaleDateString('en-GB', { timeZone: 'Africa/Mogadishu' }),
            ],
            [v.fields.paidBy, r.payload.h],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="grid grid-cols-2 gap-2 p-3">
            <dt className="text-slate-600">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
