import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { clearSession } from '../../auth/session-store';
import { t } from '../../strings';
import { mockApi, sessionFor } from '../../test/fetch-mock';
import { renderRoute } from '../../test/render';

const d = t.dashboard;
const DEPT = '0199e0a8-7c1b-7d2e-9f00-00000000000b';
const scope = {
  from: '2026-09-15',
  to: '2026-10-14',
  departmentId: DEPT,
  service: null,
  channel: null,
};
const money = {
  confirmedCents: '350000',
  refundedCents: '100',
  reversedCents: '0',
  netCents: '349900',
};
const summary = {
  scope,
  collections: money,
  outstandingCents: '1000',
  byStatus: [{ status: 'ISSUED', count: 3 }],
  processing: { decided: 5, medianHours: 30, p90Hours: 46 },
  sla: { measured: 5, onTime: 3, compliancePct: 60, overdue: 1 },
};
const collections = (groupBy: string) => ({
  scope,
  groupBy,
  rows: [
    {
      key: groupBy === 'channel' ? 'CASH' : '2026-10-14',
      label: groupBy === 'channel' ? 'CASH' : '2026-10-14',
      ...money,
    },
  ],
  totals: money,
});
const pending = {
  scope,
  departments: [
    {
      departmentId: DEPT,
      departmentName: 'Police / CID',
      queued: 2,
      oldestQueuedAt: null,
      overdue: 1,
    },
  ],
  officers: [
    {
      officerId: '0199e0a8-7c1b-7d2e-9f00-000000000001',
      officerName: 'Hodan Ali',
      departmentName: 'Police / CID',
      assigned: 1,
      oldestSince: null,
    },
    {
      officerId: '0199e0a8-7c1b-7d2e-9f00-000000000002',
      officerName: 'Abdi Nuur',
      departmentName: 'Police / CID',
      assigned: 4,
      oldestSince: null,
    },
  ],
};

function routes(role: 'SUPERVISOR' | 'ADMIN') {
  const json = (body: unknown) => () => ({ status: 200, body });
  const r: Record<string, () => { status: number; body: unknown }> = {
    'POST /api/v1/auth/refresh': json(sessionFor(role, role === 'ADMIN' ? null : 'POLICE')),
    'GET /api/v1/notifications/unread-count': json({ unread: 0 }),
    'GET /api/v1/catalogue/services': json([]),
    'GET /api/v1/reports/summary': json(summary),
    'GET /api/v1/reports/collections?groupBy=day': json(collections('day')),
    'GET /api/v1/reports/collections?groupBy=service': json(collections('service')),
    'GET /api/v1/reports/collections?groupBy=channel': json(collections('channel')),
    'GET /api/v1/reports/volumes': json({
      scope,
      weeks: [{ weekStart: '2026-10-12', submitted: 4, completed: 2 }],
    }),
    'GET /api/v1/reports/pending-work': json(pending),
  };
  return r;
}

describe('management dashboard', () => {
  beforeAll(() => {
    // Recharts measures its container; jsdom has no layout.
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    clearSession();
    vi.unstubAllGlobals();
  });

  it('should show server totals formatted from cents and link each KPI to its list', async () => {
    mockApi(routes('SUPERVISOR'));
    renderRoute('/officer/dashboard');
    expect(await screen.findByTestId('kpi-net')).toHaveTextContent('$3,499.00');
    expect(screen.getByTestId('kpi-outstanding')).toHaveTextContent('$10.00');
    expect(screen.getByTestId('kpi-sla')).toHaveTextContent('60%');
    expect(screen.getByTestId('kpi-processing')).toHaveTextContent('30 h');
    const refunds = within(screen.getByTestId('kpi-refunded')).getByRole('link');
    expect(refunds).toHaveAttribute(
      'href',
      '/officer/dashboard/details?from=2026-09-15&to=2026-10-14&view=movements&kind=REFUNDED',
    );
    // Supervisors have no department picker.
    expect(screen.queryByLabelText(d.filters.department)).not.toBeInTheDocument();
  });

  it('should sort the officer table by work in hand', async () => {
    mockApi(routes('SUPERVISOR'));
    renderRoute('/officer/dashboard');
    const table = await screen.findByTestId('officers');
    await userEvent.click(
      within(table).getByRole('button', { name: d.tables.sortBy(d.tables.assigned) }),
    );
    await userEvent.click(
      within(table).getByRole('button', { name: d.tables.sortBy(d.tables.assigned) }),
    );
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Abdi Nuur');
    expect(within(table).getAllByRole('columnheader')[2]).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('should let an admin pick a department', async () => {
    const r = routes('ADMIN');
    r[`GET /api/v1/reports/summary?departmentId=${DEPT}`] = () => ({
      status: 200,
      body: { ...summary, collections: { ...money, netCents: '100' } },
    });
    const { calls } = mockApi(r);
    renderRoute('/admin/dashboard');
    const picker = await screen.findByLabelText(d.filters.department);
    await screen.findByRole('option', { name: 'Police / CID' });
    await userEvent.selectOptions(picker, DEPT);
    await userEvent.click(screen.getByRole('button', { name: d.filters.apply }));
    await expect.poll(() => screen.getByTestId('kpi-net').textContent).toContain('$1.00');
    expect(calls.some((c) => c.key === `GET /api/v1/reports/summary?departmentId=${DEPT}`)).toBe(
      true,
    );
  });

  it('should list the drill-down rows', async () => {
    const r = routes('SUPERVISOR');
    r['GET /api/v1/reports/movements?from=2026-09-15&to=2026-10-14&kind=REFUNDED'] = () => ({
      status: 200,
      body: {
        scope,
        items: [
          {
            eventId: '0199e0a8-7c1b-7d2e-9f00-0000000000e1',
            occurredAt: '2026-10-14T08:00:00.000Z',
            kind: 'REFUNDED',
            applicationId: '0199e0a8-7c1b-7d2e-9f00-0000000000a1',
            referenceNo: 'GS-2026-000001',
            serviceName: 'Police clearance',
            channel: 'CASH',
            amountCents: '100',
          },
        ],
        nextCursor: null,
      },
    });
    mockApi(r);
    renderRoute(
      '/officer/dashboard/details?from=2026-09-15&to=2026-10-14&view=movements&kind=REFUNDED',
    );
    const table = await screen.findByTestId('drilldown');
    expect(within(table).getByText('−$1.00')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'GS-2026-000001' })).toHaveAttribute(
      'href',
      '/officer/review/0199e0a8-7c1b-7d2e-9f00-0000000000a1',
    );
    expect(screen.getByRole('button', { name: d.export })).toBeInTheDocument();
  });
});
