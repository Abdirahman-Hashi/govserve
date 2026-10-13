import { type ApplicationDetail } from '@govserve/shared';
import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { downloadCertificate, useOrderDuplicate } from '../../api/certificates';
import { ApiError } from '../../api/client';
import { FormAlert } from '../../components/form';
import { t } from '../../strings';

const c = t.certificates;
const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Africa/Mogadishu', dateStyle: 'long' });

type Cert = NonNullable<ApplicationDetail['certificate']>;

export function CertificateActions({
  cert,
}: {
  cert: Pick<Cert, 'id' | 'certificateNo' | 'status'>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [copies, setCopies] = useState(1);
  const order = useOrderDuplicate(cert.id);
  const navigate = useNavigate();
  const copiesId = useId();
  return (
    <div className="space-y-3">
      {error && <FormAlert>{error}</FormAlert>}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="rounded-md bg-brand px-4 py-2 font-semibold text-white"
          onClick={() =>
            void downloadCertificate(cert.id, cert.certificateNo).catch(() =>
              setError(c.downloadFailed),
            )
          }
        >
          {c.download}
        </button>
        {cert.status === 'VALID' && !ordering && (
          <button
            type="button"
            className="rounded-md border border-slate-400 px-4 py-2"
            onClick={() => setOrdering(true)}
          >
            {c.orderCopy}
          </button>
        )}
      </div>
      {ordering && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            order.mutate(copies, {
              onSuccess: ({ applicationId }) =>
                void navigate(`/citizen/applications/${applicationId}`),
              onError: (err) => setError(err instanceof ApiError ? err.message : t.errors.generic),
            });
          }}
        >
          <div className="space-y-1">
            <label htmlFor={copiesId} className="block text-sm font-medium">
              {c.copies}
            </label>
            <select
              id={copiesId}
              value={copies}
              onChange={(e) => setCopies(Number.parseInt(e.target.value, 10))}
              className="rounded-md border border-slate-400 px-3 py-2"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-md bg-brand px-4 py-2 font-semibold text-white"
            disabled={order.isPending}
          >
            {c.order}
          </button>
          <button type="button" className="underline" onClick={() => setOrdering(false)}>
            {t.applications.detail.cancel}
          </button>
        </form>
      )}
    </div>
  );
}

/** The certificate issued for an application (citizen view). */
export function CertificatePanel({ cert }: { cert: Cert }) {
  return (
    <section
      aria-labelledby="certificate"
      className="space-y-3 rounded-lg border border-green-700 p-4"
    >
      <h2 id="certificate" className="text-lg font-semibold">
        {c.yourCertificate}
      </h2>
      <dl className="grid grid-cols-2 gap-1 text-sm">
        <dt className="text-slate-600">{c.number}</dt>
        <dd className="font-mono" data-testid="certificate-no">
          {cert.certificateNo}
        </dd>
        <dt className="text-slate-600">{c.status}</dt>
        <dd>{c.statuses[cert.status]}</dd>
        <dt className="text-slate-600">{c.issued}</dt>
        <dd>{date(cert.issuedAt)}</dd>
        <dt className="text-slate-600">{c.expires}</dt>
        <dd>{cert.expiresAt ? date(cert.expiresAt) : c.noExpiry}</dd>
      </dl>
      <CertificateActions cert={cert} />
    </section>
  );
}
