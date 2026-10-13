import { AuditViewer } from '../../components/audit/AuditViewer';

/** Admins: every department, plus on-demand chain verification. */
export function AdminAuditPage() {
  return <AuditViewer admin />;
}
