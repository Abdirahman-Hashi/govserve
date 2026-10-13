import { ServiceStatus } from '../components/ServiceStatus';
import { t } from '../strings';

export function HomePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold sm:text-3xl">{t.home.heading}</h1>
      <p className="max-w-prose text-slate-700">{t.home.intro}</p>
      <ul className="grid gap-3 sm:grid-cols-3">
        {t.home.services.map((name) => (
          <li key={name} className="rounded-lg border border-slate-200 p-4 font-medium">
            {name}
          </li>
        ))}
      </ul>
      <ServiceStatus />
    </div>
  );
}
