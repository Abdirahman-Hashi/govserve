import { type ReactNode, useState } from 'react';
import { t } from '../../strings';

export interface Column<T> {
  key: string;
  label: string;
  /** Sort value: strings compare as text, bigints (cents) and numbers numerically. */
  sort: (row: T) => string | number | bigint | null;
  render: (row: T) => ReactNode;
  numeric?: boolean;
}

function compare(a: string | number | bigint | null, b: string | number | bigint | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A table whose column headers sort it (keyboard accessible, aria-sort announced). */
export function SortableTable<T>({
  caption,
  rows,
  columns,
  rowKey,
  testId,
}: {
  caption: string;
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  testId?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const col = columns.find((c) => c.key === sort?.key);
  const sorted =
    col && sort ? [...rows].sort((a, b) => compare(col.sort(a), col.sort(b)) * sort.dir) : rows;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-left text-sm" data-testid={testId}>
        <caption className="mb-2 text-left text-lg font-semibold">{caption}</caption>
        <thead className="border-b border-slate-300">
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={`py-2 pr-4 ${c.numeric ? 'text-right' : ''}`}
                  aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    className="font-semibold underline-offset-2 hover:underline"
                    aria-label={t.dashboard.tables.sortBy(c.label)}
                    onClick={() => setSort({ key: c.key, dir: active && sort.dir === 1 ? -1 : 1 })}
                  >
                    {c.label}
                    <span aria-hidden="true">{active ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)} className="border-b border-slate-200">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`py-2 pr-4 ${c.numeric ? 'text-right tabular-nums' : ''}`}
                >
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
