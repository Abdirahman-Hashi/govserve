import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { ServiceStatus } from '../components/ServiceStatus';
import { t } from '../strings';

export function HomePage() {
  const auth = useAuth();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold sm:text-3xl">{t.home.heading}</h1>
      <p className="max-w-prose text-slate-700">{t.home.intro}</p>
      <ul className="grid gap-3 sm:grid-cols-3">
        {t.home.services.map((name) => (
          <li key={name} className="rounded-lg border border-slate-200 p-4 font-medium">
            <Link to="/services" className="text-brand underline">
              {name}
            </Link>
          </li>
        ))}
      </ul>
      {auth.status === 'anonymous' && (
        <Link
          to="/register"
          className="inline-block rounded-md bg-brand px-4 py-3 font-semibold text-white hover:bg-brand-dark"
        >
          {t.home.getStarted}
        </Link>
      )}
      <ServiceStatus />
    </div>
  );
}
