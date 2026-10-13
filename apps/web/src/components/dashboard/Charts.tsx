import {
  centsForChart,
  type CollectionsReport,
  formatUsd,
  parseCents,
  type VolumesReport,
} from '@govserve/shared';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { t } from '../../strings';

const c = t.dashboard.charts;
const usd = (cents: number) => formatUsd(BigInt(Math.round(cents)));

/** Line chart of net collections per day; values are labelled with the shared money formatter. */
export function CollectionsChart({ report }: { report: CollectionsReport }) {
  const data = report.rows.map((r) => ({
    day: r.key.slice(5),
    net: centsForChart(parseCents(r.netCents)),
  }));
  return (
    <figure className="space-y-2">
      <figcaption className="text-lg font-semibold">{c.collections}</figcaption>
      <div className="h-64 w-full" role="img" aria-label={c.collections}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" minTickGap={16} />
            <YAxis tickFormatter={usd} width={84} />
            <Tooltip formatter={(v) => (typeof v === 'number' ? usd(v) : String(v))} />
            <Line
              type="monotone"
              dataKey="net"
              name={c.net}
              stroke="#1e3a8a"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export function VolumesChart({ report }: { report: VolumesReport }) {
  const data = report.weeks.map((w) => ({
    week: w.weekStart.slice(5),
    submitted: w.submitted,
    completed: w.completed,
  }));
  return (
    <figure className="space-y-2">
      <figcaption className="text-lg font-semibold">{c.volumes}</figcaption>
      <div className="h-64 w-full" role="img" aria-label={c.volumes}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="week" />
            <YAxis allowDecimals={false} width={40} />
            <Tooltip />
            <Legend />
            <Bar dataKey="submitted" name={c.submitted} fill="#1e3a8a" />
            <Bar dataKey="completed" name={c.completed} fill="#15803d" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
