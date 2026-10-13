import { formatUsd, parseCents } from '@govserve/shared';
import { Link } from 'react-router';
import { useStaffPayments } from '../../api/payments';
import { FormAlert } from '../../components/form';
import { t } from '../../strings';

const o = t.officerPayments;

export function PaymentsQueuePage() {
  const payments = useStaffPayments();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{o.queueHeading}</h1>
      {payments.isPending && <p role="status">{t.loading}</p>}
      {payments.isError && <FormAlert>{t.errors.generic}</FormAlert>}
      {payments.data?.length === 0 && <p>{o.empty}</p>}
      {payments.data && payments.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b border-slate-300">
              <tr>
                {Object.values(o.columns).map((c) => (
                  <th key={c} scope="col" className="py-2 pr-4">
                    {c}
                  </th>
                ))}
                <th scope="col">
                  <span className="sr-only">{o.open}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {payments.data.map((p) => (
                <tr key={p.id} className="border-b border-slate-200">
                  <td className="py-2 pr-4">{p.applicantName}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{p.applicationReferenceNo}</td>
                  <td className="py-2 pr-4">{t.payments.channels[p.channel]}</td>
                  <td className="py-2 pr-4">{formatUsd(parseCents(p.amountCents))}</td>
                  <td className="py-2 pr-4">{t.payments.statuses[p.status]}</td>
                  <td className="py-2 pr-4">
                    {new Date(p.createdAt).toLocaleString('en-GB', {
                      timeZone: 'Africa/Mogadishu',
                    })}
                  </td>
                  <td className="py-2">
                    <Link to={`/officer/payments/${p.id}`} className="text-brand underline">
                      {o.open}
                      <span className="sr-only">: {p.applicantName}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
