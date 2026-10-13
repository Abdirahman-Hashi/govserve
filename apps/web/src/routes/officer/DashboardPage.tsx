import { Dashboard } from '../../components/dashboard/Dashboard';

/** Supervisors: their own department only (the API enforces it). */
export function DashboardPage() {
  return <Dashboard admin={false} base="/officer/dashboard" />;
}
