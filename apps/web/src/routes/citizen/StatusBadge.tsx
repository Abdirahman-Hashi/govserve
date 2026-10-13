import { t } from '../../strings';

const TONE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-800',
  AWAITING_PAYMENT: 'bg-amber-100 text-amber-900',
  CORRECTION_REQUESTED: 'bg-amber-100 text-amber-900',
  AWAITING_APPOINTMENT: 'bg-amber-100 text-amber-900',
  ISSUED: 'bg-green-100 text-green-900',
  REJECTED: 'bg-red-100 text-red-900',
  REFERRED: 'bg-red-100 text-red-900',
};

/** Status shown as text (colour is a hint only, never the only signal). */
export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-sm font-semibold ${TONE[status] ?? 'bg-blue-100 text-blue-900'}`}
    >
      {t.applications.statuses[status] ?? status}
    </span>
  );
}
