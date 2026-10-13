import { Dashboard } from '../../components/dashboard/Dashboard';

/** Admins: all departments, or one picked in the filters. */
export function AdminDashboardPage() {
  return <Dashboard admin base="/admin/dashboard" />;
}
