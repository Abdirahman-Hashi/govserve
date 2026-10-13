import { type AuditEntry } from '@govserve/shared';
import { t } from '../../strings';

const a = t.audit;
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Africa/Mogadishu',
    dateStyle: 'medium',
    timeStyle: 'medium',
  });

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Audit rows as a table; details (before/after, request, hash) open per row. */
export function AuditEntries({ items }: { items: AuditEntry[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] text-left text-sm" data-testid="audit-entries">
        <thead className="border-b border-slate-300">
          <tr>
            {Object.values(a.columns).map((c) => (
              <th key={c} scope="col" className="py-2 pr-4">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.chainSeq} className="border-b border-slate-200 align-top">
              <td className="py-2 pr-4 whitespace-nowrap">
                <time dateTime={e.occurredAt}>{when(e.occurredAt)}</time>
                <span className="block text-xs text-slate-600">#{e.chainSeq}</span>
              </td>
              <td className="py-2 pr-4">
                {e.actorType === 'USER' ? (e.actorName ?? e.actorId) : a.actorTypes[e.actorType]}
                {e.actorRole && <span className="block text-xs text-slate-600">{e.actorRole}</span>}
              </td>
              <td className="py-2 pr-4 font-mono text-xs">{e.action}</td>
              <td className="py-2 pr-4">
                {e.entityType}
                <span className="block break-all font-mono text-xs text-slate-600">
                  {e.entityId}
                </span>
              </td>
              <td className="py-2 pr-4">
                <details>
                  <summary className="cursor-pointer underline">{a.columns.details}</summary>
                  <dl className="mt-2 space-y-2 text-xs">
                    {e.before !== null && (
                      <div>
                        <dt className="font-semibold">{a.before}</dt>
                        <dd>
                          <pre className="overflow-x-auto rounded bg-slate-100 p-2">
                            {json(e.before)}
                          </pre>
                        </dd>
                      </div>
                    )}
                    {e.after !== null && (
                      <div>
                        <dt className="font-semibold">{a.after}</dt>
                        <dd>
                          <pre className="overflow-x-auto rounded bg-slate-100 p-2">
                            {json(e.after)}
                          </pre>
                        </dd>
                      </div>
                    )}
                    {e.requestId && (
                      <div>
                        <dt className="font-semibold">{a.request}</dt>
                        <dd className="font-mono">
                          {e.requestId}
                          {e.ip ? ` · ${e.ip}` : ''}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt className="font-semibold">{a.hash}</dt>
                      <dd className="break-all font-mono">{e.hash}</dd>
                    </div>
                  </dl>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
