import { type SignatureCheck, verifySignature } from '@govserve/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router';
import { useNameCheck, usePublicCertificate } from '../../api/certificates';
import { ApiError } from '../../api/client';
import { usePublicKeys } from '../../api/payments';
import { FormAlert } from '../../components/form';
import { t } from '../../strings';

const v = t.verifyCertificate;
const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Africa/Mogadishu', dateStyle: 'long' });

function NameCheck({ certificateNo }: { certificateNo: string }) {
  const check = useNameCheck(certificateNo);
  const [name, setName] = useState('');
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    check.mutate(name);
  };
  return (
    <section
      aria-labelledby="name-check"
      className="space-y-3 rounded-lg border border-slate-300 p-4"
    >
      <h2 id="name-check" className="text-lg font-semibold">
        {v.nameCheck.heading}
      </h2>
      <p className="text-sm text-slate-700">{v.nameCheck.intro}</p>
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor="holder-name" className="block text-sm font-medium">
            {v.nameCheck.label}
          </label>
          <input
            id="holder-name"
            className="w-full rounded-md border border-slate-400 px-3 py-2"
            required
            minLength={2}
            maxLength={120}
            autoComplete="off"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              check.reset();
            }}
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-brand px-4 py-2 font-semibold text-white"
          disabled={check.isPending}
        >
          {v.nameCheck.submit}
        </button>
      </form>
      {check.data && (
        <FormAlert tone={check.data.match ? 'success' : 'error'}>
          {check.data.match ? v.nameCheck.match : v.nameCheck.noMatch}
        </FormAlert>
      )}
      {check.isError && (
        <FormAlert>
          {check.error instanceof ApiError && check.error.status === 429
            ? v.nameCheck.limited
            : t.errors.generic}
        </FormAlert>
      )}
    </section>
  );
}

/**
 * Public certificate check (ADR-0006). The signature travels in the URL fragment and is checked
 * here against the published key; the status comes live from the API. Only a masked name is shown.
 */
export function VerifyCertificatePage() {
  const { certificateNo = '' } = useParams();
  const { hash } = useLocation();
  const sig = new URLSearchParams(hash.replace(/^#/, '')).get('sig');
  const cert = usePublicCertificate(certificateNo);
  const keys = usePublicKeys();
  const [verified, setVerified] = useState<{ sig: string; result: SignatureCheck } | null>(null);
  const key = cert.data && keys.data?.keys.find((k) => k.kid === cert.data.payload.kid);

  useEffect(() => {
    if (!cert.data || !key || !sig) return;
    let cancelled = false;
    void verifySignature(cert.data.payload, sig, key.publicKey).then((result) => {
      if (!cancelled) setVerified({ sig, result });
    });
    return () => {
      cancelled = true;
    };
  }, [cert.data, key, sig]);

  const check: SignatureCheck | 'MISSING' | null =
    !cert.data || !keys.data
      ? null
      : !sig
        ? 'MISSING'
        : !key
          ? 'INVALID'
          : verified?.sig === sig
            ? verified.result
            : null;

  if (cert.isPending) return <p role="status">{t.loading}</p>;
  if (cert.isError) {
    return (
      <FormAlert>
        {cert.error instanceof ApiError && cert.error.status === 404
          ? v.notFound
          : t.errors.generic}
      </FormAlert>
    );
  }
  const c = cert.data;
  const ok = c.status === 'VALID' && check !== 'INVALID';
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
        className={`text-xl font-bold ${ok ? 'text-green-800' : 'text-red-800'}`}
        data-testid="certificate-status"
      >
        <span aria-hidden="true">{ok ? '✓ ' : '✕ '}</span>
        {v.status[c.status]}
      </p>
      {signature && <FormAlert tone={signature.tone}>{signature.text}</FormAlert>}
      <dl className="divide-y divide-slate-200 rounded-lg border border-slate-300 text-sm">
        {(
          [
            [v.fields.certificateNo, c.certificateNo],
            [v.fields.type, c.serviceName],
            [v.fields.holder, c.holderNameMasked],
            [v.fields.issued, date(c.issuedAt)],
            [v.fields.expires, c.expiresAt ? date(c.expiresAt) : v.noExpiry],
            ...(c.revokedAt ? [[v.fields.revoked, date(c.revokedAt)] as const] : []),
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="grid grid-cols-2 gap-2 p-3">
            <dt className="text-slate-600">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {c.status !== 'REVOKED' && <NameCheck certificateNo={c.certificateNo} />}
    </div>
  );
}
