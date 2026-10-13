import { Link, useParams } from 'react-router';
import { useApplicationAudit } from '../../api/audit';
import { useStaffApplication } from '../../api/review';
import { AuditEntries } from '../../components/audit/AuditEntries';
import { FormAlert } from '../../components/form';
import { t } from '../../strings';

/** The full history of one application, oldest first (supervisors, own department). */
export function ApplicationAuditPage() {
  const { id = '' } = useParams();
  const history = useApplicationAudit(id);
  const app = useStaffApplication(id);
  return (
    <div className="space-y-6">
      <p>
        <Link to={`/officer/review/${id}`} className="text-brand underline">
          ← {app.data?.referenceNo ?? t.review.back}
        </Link>
      </p>
      <h1 className="text-2xl font-bold">{t.audit.historyHeading(app.data?.referenceNo ?? '')}</h1>
      {history.isPending && <p role="status">{t.loading}</p>}
      {history.isError && <FormAlert>{t.errors.generic}</FormAlert>}
      {history.data && <AuditEntries items={history.data.items} />}
    </div>
  );
}
