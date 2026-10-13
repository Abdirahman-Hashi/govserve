import { DashboardDetails } from '../../components/dashboard/DashboardDetails';

/** Kept apart from the dashboard so the list does not download the chart library. */
export function DashboardDetailsPage() {
  return <DashboardDetails base="/officer/dashboard" reviewBase="/officer/review" />;
}
