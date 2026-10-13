import { AuditViewer } from '../../components/audit/AuditViewer';

/** Supervisors: their department's entries only (enforced by the API). */
export function AuditPage() {
  return <AuditViewer admin={false} />;
}
