import { DashboardDetails } from '../../components/dashboard/DashboardDetails';

/** Admins have no review screen, so references are not linked. */
export function AdminDashboardDetailsPage() {
  return <DashboardDetails base="/admin/dashboard" reviewBase={null} />;
}
