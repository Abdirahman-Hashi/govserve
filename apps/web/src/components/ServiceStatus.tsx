import { useServiceStatus } from '../api/health';
import { t } from '../strings';

export function ServiceStatus() {
  const { data, isPending, isError } = useServiceStatus();

  let message: string = t.status.checking;
  let tone = 'border-slate-300 bg-slate-50 text-slate-800';
  let icon = '…';
  if (isError) {
    message = t.status.unreachable;
    tone = 'border-red-300 bg-red-50 text-red-900';
    icon = '✕';
  } else if (!isPending) {
    const ok = data.status === 'ok';
    message = ok ? t.status.ok : t.status.degraded;
    tone = ok
      ? 'border-green-300 bg-green-50 text-green-900'
      : 'border-amber-300 bg-amber-50 text-amber-900';
    icon = ok ? '✓' : '!';
  }

  return (
    <section aria-labelledby="service-status-heading" className={`rounded-lg border p-4 ${tone}`}>
      <h2 id="service-status-heading" className="sr-only">
        {t.status.label}
      </h2>
      {/* Icon + text so colour is never the only signal. */}
      <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm font-medium">
        <span aria-hidden="true">{icon}</span>
        {message}
      </p>
    </section>
  );
}
