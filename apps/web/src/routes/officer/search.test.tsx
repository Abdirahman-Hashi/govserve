import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSession } from '../../auth/session-store';
import { t } from '../../strings';
import { mockApi, sessionFor } from '../../test/fetch-mock';
import { renderRoute } from '../../test/render';

const s = t.search;
const hit = (n: number) => ({
  id: `0199e0a8-7c1b-7d2e-9f00-${String(n).padStart(12, '0')}`,
  referenceNo: `GS-2026-${String(n).padStart(6, '0')}`,
  serviceName: 'Police clearance',
  applicantName: 'Cabdi Xasan',
  subjectName: 'Cabdi Xasan',
  status: 'QUEUED',
  assigneeName: null,
  createdAt: '2026-10-14T08:00:00.000Z',
  submittedAt: '2026-10-14T08:00:00.000Z',
});

describe('staff search', () => {
  afterEach(() => {
    clearSession();
    vi.unstubAllGlobals();
  });

  it('should send criteria in the body (never the URL) and page with the cursor', async () => {
    const { calls } = mockApi({
      'POST /api/v1/auth/refresh': () => ({ status: 200, body: sessionFor('OFFICER', 'POLICE') }),
      'GET /api/v1/catalogue/services': () => ({ status: 200, body: [] }),
      'GET /api/v1/notifications/unread-count': () => ({ status: 200, body: { unread: 0 } }),
      'POST /api/v1/search/applications': (body) =>
        (body as { cursor?: string }).cursor
          ? { status: 200, body: { items: [hit(2)], nextCursor: null } }
          : {
              status: 200,
              body: { items: [hit(1)], nextCursor: 'MjAyNi0xMC0xNFQwODowMDowMC4wMDBafGFiYw' },
            },
    });
    renderRoute('/officer/search');
    await userEvent.type(await screen.findByLabelText(s.fields.nationalId), 'SO 555 0001');
    await userEvent.click(screen.getByRole('button', { name: s.submit }));
    const table = await screen.findByTestId('application-results');
    expect(within(table).getByRole('link', { name: 'GS-2026-000001' })).toHaveAttribute(
      'href',
      '/officer/review/0199e0a8-7c1b-7d2e-9f00-000000000001',
    );
    await userEvent.click(screen.getByRole('button', { name: s.more }));
    expect(await within(table).findByText('GS-2026-000002')).toBeInTheDocument();
    const searches = calls.filter((c) => c.key.startsWith('POST /api/v1/search'));
    expect(searches[0]!.body).toEqual({ nationalId: 'SO 555 0001' });
    expect(searches[1]!.body).toMatchObject({
      nationalId: 'SO 555 0001',
      cursor: expect.any(String) as string,
    });
    expect(calls.every((c) => !c.key.includes('555'))).toBe(true);
    // Officers cannot export.
    expect(screen.queryByRole('button', { name: s.export })).not.toBeInTheDocument();
  });

  it('should convert the amount range to integer cents and offer supervisors the export', async () => {
    const { calls } = mockApi({
      'POST /api/v1/auth/refresh': () => ({
        status: 200,
        body: sessionFor('SUPERVISOR', 'POLICE'),
      }),
      'GET /api/v1/catalogue/services': () => ({ status: 200, body: [] }),
      'GET /api/v1/notifications/unread-count': () => ({ status: 200, body: { unread: 0 } }),
      'POST /api/v1/search/payments': () => ({
        status: 200,
        body: { items: [], nextCursor: null },
      }),
    });
    renderRoute('/officer/search');
    await userEvent.click(await screen.findByRole('tab', { name: s.tabs.payments }));
    await userEvent.type(screen.getByLabelText(s.fields.minAmount), '0.1');
    await userEvent.click(screen.getByRole('button', { name: s.submit }));
    expect(await screen.findByText(s.noMatches)).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/v1/search/payments')?.body).toEqual({
      minCents: '10',
    });
    expect(screen.getByRole('button', { name: s.export })).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(s.fields.maxAmount));
    await userEvent.type(screen.getByLabelText(s.fields.maxAmount), '12.345');
    await userEvent.click(screen.getByRole('button', { name: s.submit }));
    expect(await screen.findByText(s.badAmount)).toBeInTheDocument();
  });
});

describe('citizen history', () => {
  afterEach(() => {
    clearSession();
    vi.unstubAllGlobals();
  });

  it('should filter my applications by status', async () => {
    const summary = {
      id: '0199e0a8-7c1b-7d2e-9f00-00000000aaaa',
      referenceNo: 'GS-2026-000042',
      serviceCode: 'PROOF_OF_ADDRESS',
      serviceName: 'Proof of address',
      status: 'ISSUED',
      createdAt: '2026-10-14T08:00:00.000Z',
      updatedAt: '2026-10-14T08:00:00.000Z',
      submittedAt: '2026-10-14T08:00:00.000Z',
    };
    const { calls } = mockApi({
      'POST /api/v1/auth/refresh': () => ({ status: 200, body: sessionFor('CITIZEN') }),
      'GET /api/v1/catalogue/services': () => ({ status: 200, body: [] }),
      'GET /api/v1/notifications/unread-count': () => ({ status: 200, body: { unread: 0 } }),
      'GET /api/v1/applications': () => ({ status: 200, body: { items: [], nextCursor: null } }),
      'GET /api/v1/applications?status=ISSUED': () => ({
        status: 200,
        body: { items: [summary], nextCursor: null },
      }),
    });
    renderRoute('/citizen');
    expect(await screen.findByText(t.applications.none)).toBeInTheDocument();
    await userEvent.click(screen.getByText(t.history.filters));
    await userEvent.selectOptions(screen.getByLabelText(t.history.status), 'ISSUED');
    await userEvent.click(screen.getByRole('button', { name: t.history.apply }));
    expect(await screen.findByRole('link', { name: 'Proof of address' })).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'GET /api/v1/applications?status=ISSUED')).toBe(true);
  });
});
