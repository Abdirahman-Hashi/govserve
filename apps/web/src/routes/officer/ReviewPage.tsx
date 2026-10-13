import { formatUsd, parseCents, type StaffAction, type StaffApplication } from '@govserve/shared';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { useRevokeCertificate } from '../../api/certificates';
import { ApiError } from '../../api/client';
import { staffDocumentTicket, useStaffReasonCodes } from '../../api/payments';
import {
  type ReviewActionPath,
  unmaskApplication,
  useReviewAction,
  useStaffApplication,
} from '../../api/review';
import { FormAlert } from '../../components/form';
import { t } from '../../strings';

const r = t.review;
const f = r.form;
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Africa/Mogadishu',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

const input = 'w-full rounded-md border border-slate-400 px-3 py-2';
const primary = 'rounded-md bg-brand px-4 py-2 font-semibold text-white disabled:opacity-60';
const secondary = 'rounded-md border border-slate-400 px-4 py-2';

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

type Submit = (path: ReviewActionPath, body: object) => void;

/** Actions that need more input than a confirmation open a small form. */
function ActionForm({
  action,
  app,
  submit,
  pending,
  onCancel,
}: {
  action: StaffAction;
  app: StaffApplication;
  submit: Submit;
  pending: boolean;
  onCancel: () => void;
}) {
  const reasons = useStaffReasonCodes('REJECT');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [location, setLocation] = useState('');
  const [outcome, setOutcome] = useState<'ATTENDED' | 'NO_SHOW'>('ATTENDED');
  const [attendees, setAttendees] = useState('');
  const [decision, setDecision] = useState<'KEEP' | 'REVOKE'>('KEEP');
  const [items, setItems] = useState([
    { kind: 'FIELD', target: '', comment: '' },
  ]);
  const fields = app.uiSchema.order;
  const docs = app.requiredDocuments.map((d) => d.type);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    switch (action) {
      case 'REQUEST_CORRECTION':
        return submit('corrections', { items: items.filter((i) => i.target) });
      case 'SCHEDULE_APPOINTMENT':
        return submit('appointment', {
          scheduledAt: new Date(scheduledAt).toISOString(),
          location,
        });
      case 'RECORD_APPOINTMENT': {
        const list = attendees
          .split('\n')
          .map((l) => l.split(',').map((p) => p.trim()))
          .filter(([name]) => name)
          .map(([name = '', role = '']) => ({ name, role }));
        return submit('appointment/outcome', {
          outcome,
          ...(list.length > 0 && { attendees: list }),
        });
      }
      case 'REFER':
        return submit('refer', { note });
      case 'REJECT':
        return submit('reject', { reasonCode: reason, note });
      case 'RETURN':
        return submit('return', { note });
      case 'RESOLVE_CHARGEBACK':
        return submit('chargeback', { decision, note });
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-lg border border-slate-400 p-4"
      aria-label={r.actions[action]}
    >
      <h3 className="font-semibold">{r.actions[action]}</h3>
      {action === 'REQUEST_CORRECTION' &&
        items.map((item, i) => (
          <fieldset key={i} className="space-y-2 border-b border-slate-200 pb-3">
            <legend className="sr-only">{`${f.flag} ${i + 1}`}</legend>
            <div className="flex flex-wrap gap-2">
              <Field label={f.flag}>
                {(id) => (
                  <select
                    id={id}
                    className={input}
                    value={item.kind}
                    onChange={(e) =>
                      setItems(
                        items.map((x, j) =>
                          j === i ? { ...x, kind: e.target.value, target: '' } : x,
                        ),
                      )
                    }
                  >
                    <option value="FIELD">{f.field}</option>
                    <option value="DOCUMENT">{f.document}</option>
                  </select>
                )}
              </Field>
              <Field label={item.kind === 'FIELD' ? f.field : f.document}>
                {(id) => (
                  <select
                    id={id}
                    className={input}
                    value={item.target}
                    required
                    onChange={(e) =>
                      setItems(
                        items.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)),
                      )
                    }
                  >
                    <option value="">{t.form.choose}</option>
                    {(item.kind === 'FIELD' ? fields : docs).map((k) => (
                      <option key={k} value={k}>
                        {item.kind === 'FIELD'
                          ? (app.formSchema.properties[k]?.title ?? k)
                          : (app.requiredDocuments.find((d) => d.type === k)?.label ?? k)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <Field label={f.comment}>
              {(id) => (
                <input
                  id={id}
                  className={input}
                  required
                  minLength={5}
                  value={item.comment}
                  onChange={(e) =>
                    setItems(items.map((x, j) => (j === i ? { ...x, comment: e.target.value } : x)))
                  }
                />
              )}
            </Field>
            {items.length > 1 && (
              <button
                type="button"
                className="text-sm underline"
                onClick={() => setItems(items.filter((_, j) => j !== i))}
              >
                {f.remove}
              </button>
            )}
          </fieldset>
        ))}
      {action === 'REQUEST_CORRECTION' && (
        <button
          type="button"
          className="text-sm underline"
          onClick={() => setItems([...items, { kind: 'FIELD', target: '', comment: '' }])}
        >
          {f.addItem}
        </button>
      )}
      {action === 'SCHEDULE_APPOINTMENT' && (
        <>
          <Field label={f.when}>
            {(id) => (
              <input
                id={id}
                type="datetime-local"
                className={input}
                required
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            )}
          </Field>
          <Field label={f.location}>
            {(id) => (
              <input
                id={id}
                className={input}
                required
                minLength={3}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            )}
          </Field>
        </>
      )}
      {action === 'RECORD_APPOINTMENT' && (
        <>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{f.outcome}</legend>
            {(['ATTENDED', 'NO_SHOW'] as const).map((o) => (
              <label key={o} className="mr-4 inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="outcome"
                  checked={outcome === o}
                  onChange={() => setOutcome(o)}
                />
                {o === 'ATTENDED' ? f.attended : f.noShow}
              </label>
            ))}
          </fieldset>
          {app.inPersonStep === 'APPEARANCE' && outcome === 'ATTENDED' && (
            <Field label={f.attendees}>
              {(id) => (
                <textarea
                  id={id}
                  className={input}
                  rows={3}
                  required
                  value={attendees}
                  onChange={(e) => setAttendees(e.target.value)}
                />
              )}
            </Field>
          )}
        </>
      )}
      {action === 'REJECT' && (
        <Field label={f.reason}>
          {(id) => (
            <select
              id={id}
              className={input}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              <option value="">{t.form.choose}</option>
              {reasons.data?.map((rc) => (
                <option key={rc.code} value={rc.code}>
                  {rc.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {action === 'RESOLVE_CHARGEBACK' && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">{f.decision}</legend>
          {(['KEEP', 'REVOKE'] as const).map((d) => (
            <label key={d} className="mr-4 inline-flex items-center gap-2">
              <input
                type="radio"
                name="decision"
                checked={decision === d}
                onChange={() => setDecision(d)}
              />
              {d === 'KEEP' ? f.keep : f.revoke}
            </label>
          ))}
        </fieldset>
      )}
      {['REFER', 'REJECT', 'RETURN', 'RESOLVE_CHARGEBACK'].includes(action) && (
        <Field label={action === 'REFER' ? f.referNote : f.note}>
          {(id) => (
            <textarea
              id={id}
              className={input}
              rows={3}
              required
              minLength={5}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
      )}
      <div className="flex gap-3">
        <button type="submit" className={primary} disabled={pending}>
          {r.confirm}
        </button>
        <button type="button" className="underline" onClick={onCancel}>
          {r.cancel}
        </button>
      </div>
    </form>
  );
}

/** One-click actions (a confirmation step guards the decisions). */
const SIMPLE: Partial<Record<StaffAction, ReviewActionPath>> = {
  CLAIM: 'claim',
  RELEASE: 'release',
  APPROVE: 'approve',
  SECOND_APPROVE: 'second-approve',
  CONFIRM_REFERRAL: 'confirm-referral',
};

function RevokePanel({ app }: { app: StaffApplication }) {
  const cert = app.certificate!;
  const revoke = useRevokeCertificate(cert.id);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<'FRAUD' | 'ERROR' | 'CHARGEBACK'>('ERROR');
  const [note, setNote] = useState('');
  if (!open)
    return (
      <button
        type="button"
        className="text-sm text-red-800 underline"
        onClick={() => setOpen(true)}
      >
        {r.revoke.heading}
      </button>
    );
  return (
    <form
      className="space-y-2 rounded-md border border-red-300 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        revoke.mutate({ reason, note }, { onSuccess: () => setOpen(false) });
      }}
    >
      {revoke.isError && (
        <FormAlert>
          {revoke.error instanceof ApiError ? revoke.error.message : t.errors.generic}
        </FormAlert>
      )}
      <Field label={r.revoke.reason}>
        {(id) => (
          <select
            id={id}
            className={input}
            value={reason}
            onChange={(e) => setReason(e.target.value as 'ERROR')}
          >
            {Object.entries(r.revoke.reasons).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={f.note}>
        {(id) => (
          <textarea
            id={id}
            className={input}
            required
            minLength={5}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
      <div className="flex gap-3">
        <button type="submit" className="rounded-md bg-red-800 px-4 py-2 font-semibold text-white">
          {r.revoke.submit}
        </button>
        <button type="button" className="underline" onClick={() => setOpen(false)}>
          {r.cancel}
        </button>
      </div>
    </form>
  );
}

export function ReviewPage() {
  const { id = '' } = useParams();
  const query = useStaffApplication(id);
  const action = useReviewAction(id);
  const auth = useAuth();
  const [open, setOpen] = useState<StaffAction | null>(null);
  const [confirming, setConfirming] = useState<StaffAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clear, setClear] = useState<Record<string, unknown> | null>(null);

  if (query.isPending) return <p role="status">{t.loading}</p>;
  if (query.isError) return <FormAlert>{t.errors.generic}</FormAlert>;
  const app = query.data;
  const isSupervisor = auth.status === 'authenticated' && auth.user.role === 'SUPERVISOR';

  const submit: Submit = (path, body) => {
    setError(null);
    action.mutate(
      { path, body: { version: app.version, ...body } },
      {
        onSuccess: () => {
          setOpen(null);
          setConfirming(null);
        },
        onError: (err) => {
          setConfirming(null);
          setError(
            err instanceof ApiError && err.code === 'CONCURRENT_UPDATE'
              ? r.stale
              : err instanceof ApiError
                ? err.message
                : t.errors.generic,
          );
        },
      },
    );
  };

  const actions = app.allowedActions.filter((a) => a !== 'ASSIGN');
  const label = (a: StaffAction) =>
    a === 'APPROVE' && app.approvalMode === 'SUPERVISOR_SECOND' ? r.approveForward : r.actions[a];
  const values = clear ?? app.formData;

  return (
    <div className="max-w-3xl space-y-8">
      <p>
        <Link to="/officer" className="text-brand underline">
          ← {r.back}
        </Link>
      </p>
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">
          {app.serviceName} <span className="font-mono text-lg">{app.referenceNo}</span>
        </h1>
        <p data-testid="review-status" className="font-semibold">
          {r.statuses[app.status]} · {r.risks[app.slaRisk]}
        </p>
        <dl className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-4">
          <dt className="text-slate-600">{r.applicant}</dt>
          <dd>{app.applicantName}</dd>
          <dt className="text-slate-600">{r.assignee}</dt>
          <dd>{app.assigneeName ?? r.unassigned}</dd>
          {app.claimExpiresAt && (
            <>
              <dt className="text-slate-600">{r.claimExpires}</dt>
              <dd>{when(app.claimExpiresAt)}</dd>
            </>
          )}
        </dl>
      </div>

      {app.chargebackFlag && <FormAlert>{r.chargeback}</FormAlert>}
      {error && <FormAlert>{error}</FormAlert>}

      {actions.length > 0 && (
        <section aria-label={t.nav.reviewQueue} className="space-y-3">
          {app.allowedActions.includes('APPROVE') && app.approvalBlockers.length > 0 && (
            <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm">
              <p className="font-semibold">{r.blockers}</p>
              <ul className="list-disc pl-5">
                {app.approvalBlockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <button
                key={a}
                type="button"
                className={
                  a === 'APPROVE' || a === 'SECOND_APPROVE' || a === 'CLAIM' ? primary : secondary
                }
                disabled={action.isPending || (a === 'APPROVE' && app.approvalBlockers.length > 0)}
                onClick={() => {
                  setError(null);
                  if (SIMPLE[a]) setConfirming(a);
                  else setOpen(a);
                }}
              >
                {label(a)}
              </button>
            ))}
          </div>
          {confirming && (
            <div
              role="group"
              aria-label={label(confirming)}
              className="flex flex-wrap items-center gap-3 rounded-md border border-slate-400 p-3"
            >
              <p>{label(confirming)}?</p>
              <button
                type="button"
                className={primary}
                disabled={action.isPending}
                onClick={() => submit(SIMPLE[confirming]!, {})}
              >
                {r.confirm}
              </button>
              <button type="button" className="underline" onClick={() => setConfirming(null)}>
                {r.cancel}
              </button>
            </div>
          )}
          {open && (
            <ActionForm
              key={open}
              action={open}
              app={app}
              submit={submit}
              pending={action.isPending}
              onCancel={() => setOpen(null)}
            />
          )}
        </section>
      )}

      {app.certificate && (
        <Section title={r.certificate}>
          <p className="text-sm">
            <span className="font-mono">{app.certificate.certificateNo}</span> ·{' '}
            {t.certificates.statuses[app.certificate.status]}
            {app.certificate.revokeReason &&
              ` · ${t.certificates.revokeReasons[app.certificate.revokeReason]}`}
          </p>
          {isSupervisor && app.certificate.status === 'VALID' && <RevokePanel app={app} />}
        </Section>
      )}

      <Section title={r.answers}>
        {app.maskedFields.length > 0 && !clear && (
          <button
            type="button"
            className="text-sm underline"
            onClick={() =>
              void unmaskApplication(app.id)
                .then((res) => setClear(res.formData))
                .catch(() => setError(t.errors.generic))
            }
          >
            {r.showPersonal}
          </button>
        )}
        {clear && <p className="text-sm text-slate-700">{r.personalShown}</p>}
        <dl className="divide-y divide-slate-200 text-sm">
          {app.uiSchema.order
            .filter((k) => values[k] !== undefined)
            .map((k) => (
              <div key={k} className="grid grid-cols-2 gap-2 py-1.5">
                <dt className="text-slate-600">{app.formSchema.properties[k]?.title ?? k}</dt>
                <dd data-testid={`answer-${k}`}>{String(values[k])}</dd>
              </div>
            ))}
        </dl>
      </Section>

      <Section title={r.documents}>
        <ul className="divide-y divide-slate-200 text-sm">
          {app.documents.map((d) => (
            <li key={d.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span>
                {app.requiredDocuments.find((x) => x.type === d.docType)?.label ?? d.docType} —{' '}
                {d.originalName}
              </span>
              {d.status === 'CLEAN' && (
                <button
                  type="button"
                  className="underline"
                  onClick={() =>
                    void staffDocumentTicket(d.id)
                      .then((ticket) => window.open(ticket.url, '_blank', 'noopener'))
                      .catch(() => setError(t.errors.generic))
                  }
                >
                  {r.view}
                </button>
              )}
            </li>
          ))}
        </ul>
      </Section>

      {app.feeAssessment && (
        <Section title={r.payments}>
          <p className="text-sm">
            {r.paid(
              formatUsd(parseCents(app.paidCents)),
              formatUsd(parseCents(app.feeAssessment.totalCents)),
            )}
          </p>
        </Section>
      )}

      {app.appointments.length > 0 && (
        <Section title={r.appointments}>
          <ul className="space-y-1 text-sm">
            {app.appointments.map((a) => (
              <li key={a.id}>
                {t.appointment.kinds[a.kind]} · {when(a.scheduledAt)} · {a.location} —{' '}
                {t.appointment.statuses[a.status]}
                {a.attendees && ` (${a.attendees.map((x) => `${x.name}, ${x.role}`).join('; ')})`}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {app.corrections.length > 0 && (
        <Section title={r.corrections}>
          <ul className="space-y-2 text-sm">
            {app.corrections.map((c) => (
              <li key={c.round}>
                <p className="font-medium">
                  {c.round} · {when(c.dueAt)}
                  {c.resolvedAt && ` · ✓ ${when(c.resolvedAt)}`}
                </p>
                <ul className="list-disc pl-5">
                  {c.items.map((i) => (
                    <li key={`${i.kind}${i.target}`}>
                      {i.target}: {i.comment}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {app.decisions.length > 0 && (
        <Section title={r.decisions}>
          <ul className="space-y-1 text-sm">
            {app.decisions.map((d) => (
              <li key={d.decidedAt}>
                {when(d.decidedAt)} · {d.decidedByName} · {d.level} {d.decision}
                {d.outcome && ` (${d.outcome})`}
                {d.note && ` — ${d.note}`}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={r.history}>
        <ol className="space-y-1 border-l-2 border-slate-300 pl-4 text-sm">
          {app.history.map((h, i) => (
            <li key={i}>
              <span className="font-medium">{r.statuses[h.toStatus] ?? h.toStatus}</span> ·{' '}
              {when(h.at)}
              {h.actorName && ` · ${h.actorName}`}
              {h.note && ` — ${h.note}`}
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
