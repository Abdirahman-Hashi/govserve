import { Link } from 'react-router';
import { useMyApplications } from '../../api/applications';
import { FormAlert } from '../../components/form';
import { t } from '../../strings';
import { StatusBadge } from './StatusBadge';

const a = t.applications;
const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Africa/Mogadishu' });

export function CitizenHome() {
  const apps = useMyApplications();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{a.myHeading}</h1>
      <Link
        to="/services"
        className="inline-block rounded-md bg-brand px-4 py-2 font-semibold text-white"
      >
        {a.browse}
      </Link>
      {apps.isPending && <p role="status">{t.loading}</p>}
      {apps.isError && <FormAlert>{t.errors.generic}</FormAlert>}
      {apps.data?.length === 0 && <p>{a.none}</p>}
      <ul className="space-y-3">
        {apps.data?.map((app) => (
          <li key={app.id} className="rounded-lg border border-slate-300 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link
                to={`/citizen/applications/${app.id}`}
                className="font-semibold text-brand underline"
              >
                {app.serviceName}
              </Link>
              <StatusBadge status={app.status} />
            </div>
            <p className="mt-1 text-sm text-slate-700">
              {app.referenceNo ? `${a.reference}: ${app.referenceNo} · ` : ''}
              {app.submittedAt
                ? `${a.submitted} ${date(app.submittedAt)}`
                : `${a.started} ${date(app.createdAt)}`}
            </p>
            {app.status === 'DRAFT' && (
              <Link
                to={`/citizen/applications/${app.id}`}
                className="mt-2 inline-block text-sm underline"
              >
                {a.continueDraft}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
