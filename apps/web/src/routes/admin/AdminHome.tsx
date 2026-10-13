import { t } from '../../strings';

/** Placeholder until the admin features land (see docs/PROGRESS.md). */
export function AdminHome() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">{t.nav.admin}</h1>
      <p className="text-slate-700">{t.placeholder.comingSoon}</p>
    </div>
  );
}
