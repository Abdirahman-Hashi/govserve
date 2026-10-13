import { useNotificationPreferences, useSetNotificationPreferences } from '../../api/notifications';
import { t } from '../../strings';

const p = t.notifications.prefs;

export function NotificationPreferences() {
  const prefs = useNotificationPreferences();
  const save = useSetNotificationPreferences();
  return (
    <section aria-labelledby="prefs-heading" className="space-y-3">
      <h2 id="prefs-heading" className="text-lg font-semibold">
        {p.heading}
      </h2>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5"
          checked={prefs.data?.emailOptional ?? true}
          disabled={!prefs.data || save.isPending}
          aria-describedby="prefs-hint"
          onChange={(e) => save.mutate({ emailOptional: e.target.checked })}
        />
        <span>{p.optional}</span>
      </label>
      <p id="prefs-hint" className="text-sm text-slate-700">
        {p.optionalHint}
      </p>
      <p className="text-sm text-slate-700">{p.always}</p>
      {save.isSuccess && (
        <p role="status" className="text-sm text-green-800">
          ✓ {p.saved}
        </p>
      )}
    </section>
  );
}
