import { useMyCertificates } from '../../api/certificates';
import { FormAlert } from '../../components/form';
import { t } from '../../strings';
import { CertificateActions } from './CertificatePanel';

const c = t.certificates;
const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Africa/Mogadishu', dateStyle: 'long' });

export function CertificatesPage() {
  const certs = useMyCertificates();
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">{c.heading}</h1>
      {certs.isPending && <p role="status">{t.loading}</p>}
      {certs.isError && <FormAlert>{t.errors.generic}</FormAlert>}
      {certs.data?.length === 0 && <p>{c.none}</p>}
      <ul className="space-y-4">
        {certs.data?.map((cert) => (
          <li key={cert.id} className="space-y-3 rounded-lg border border-slate-300 p-4">
            <div>
              <h2 className="text-lg font-semibold">
                {cert.serviceName}
                {cert.isDuplicate && <span className="text-sm font-normal"> · {c.copy}</span>}
              </h2>
              <p className="font-mono text-sm">{cert.certificateNo}</p>
            </div>
            <dl className="grid grid-cols-2 gap-1 text-sm">
              <dt className="text-slate-600">{c.status}</dt>
              <dd className={cert.status === 'VALID' ? 'text-green-800' : 'text-red-800'}>
                {cert.revokeReason ? c.revokeReasons[cert.revokeReason] : c.statuses[cert.status]}
              </dd>
              <dt className="text-slate-600">{c.issued}</dt>
              <dd>{date(cert.issuedAt)}</dd>
              <dt className="text-slate-600">{c.expires}</dt>
              <dd>{cert.expiresAt ? date(cert.expiresAt) : c.noExpiry}</dd>
            </dl>
            {cert.status !== 'REVOKED' && <CertificateActions cert={cert} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
