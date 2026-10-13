import {
  assessFee,
  type FeeRuleJson,
  formatUsd,
  MAX_EXTRA_COPIES,
  parseCents,
} from '@govserve/shared';
import { useId, useState } from 'react';
import { t } from '../strings';

/**
 * Fee preview using the shared fee function (FR-040). Display only: the API assesses the
 * real amount on submit, so nothing here is trusted by the server.
 */
export function FeeEstimate({ fee, provisional }: { fee: FeeRuleJson; provisional: boolean }) {
  const [copies, setCopies] = useState(0);
  const id = useId();
  const rule = { baseCents: parseCents(fee.baseCents), perCopyCents: parseCents(fee.perCopyCents) };
  const result = assessFee(rule, copies);

  return (
    <section
      aria-labelledby={`${id}-h`}
      className="space-y-3 rounded-lg border border-slate-300 p-4"
    >
      <h2 id={`${id}-h`} className="text-lg font-semibold">
        {t.catalogue.feeHeading}
      </h2>
      {provisional && (
        <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
          <span aria-hidden="true">! </span>
          {t.catalogue.provisional}
        </p>
      )}
      <div>
        <label htmlFor={`${id}-copies`} className="block text-sm font-medium">
          {t.catalogue.extraCopies}
        </label>
        <select
          id={`${id}-copies`}
          value={copies}
          onChange={(e) => setCopies(Number(e.target.value))}
          className="mt-1 rounded-md border border-slate-400 px-3 py-2"
        >
          {Array.from({ length: MAX_EXTRA_COPIES + 1 }, (_, n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <dl className="space-y-1 text-sm">
        {result.lines.map((line) => (
          <div key={line.code} className="flex justify-between gap-4">
            <dt>
              {line.code === 'BASE'
                ? t.catalogue.baseFee
                : t.catalogue.copyLine(line.qty, formatUsd(line.unitCents))}
            </dt>
            <dd>{formatUsd(line.amountCents)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t border-slate-300 pt-1 font-semibold">
          <dt>{t.catalogue.total}</dt>
          <dd aria-live="polite" data-testid="fee-total">
            {formatUsd(result.totalCents)}
          </dd>
        </div>
      </dl>
    </section>
  );
}
