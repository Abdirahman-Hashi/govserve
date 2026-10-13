import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSession } from '../../auth/session-store';
import { t } from '../../strings';
import { mockApi, sessionFor } from '../../test/fetch-mock';
import { renderRoute } from '../../test/render';

const a = t.audit;
const entry = {
  chainSeq: '42',
  occurredAt: '2026-10-14T08:00:00.000Z',
  actorId: '0199e0a8-7c1b-7d2e-9f00-000000000001',
  actorName: 'Hodan Ali',
  actorRole: 'SUPERVISOR',
  actorType: 'USER',
  action: 'CERTIFICATE_REVOKED',
  entityType: 'Certificate',
  entityId: '0199e0a8-7c1b-7d2e-9f00-0000000000c1',
  departmentId: null,
  before: null,
  after: { reason: 'ERROR' },
  ip: '10.0.0.1',
  userAgent: 'test',
  requestId: 'req-1',
  hash: 'ab'.repeat(32),
};

describe('audit viewer', () => {
  afterEach(() => {
    clearSession();
    vi.unstubAllGlobals();
  });

  it('should show entries with details and let an admin verify the chain', async () => {
    const { calls } = mockApi({
      'POST /api/v1/auth/refresh': () => ({ status: 200, body: sessionFor('ADMIN', null) }),
      'GET /api/v1/notifications/unread-count': () => ({ status: 200, body: { unread: 0 } }),
      'GET /api/v1/audit': () => ({ status: 200, body: { items: [entry], nextCursor: null } }),
      'GET /api/v1/audit?action=CERTIFICATE_REVOKED': () => ({
        status: 200,
        body: { items: [entry], nextCursor: null },
      }),
      'POST /api/v1/audit/verify': () => ({
        status: 200,
        body: {
          ok: false,
          rows: 1241,
          verifiedAt: '2026-10-14T09:00:00.000Z',
          broken: { chainSeq: '7', problem: 'ROW_CHANGED' },
        },
      }),
    });
    renderRoute('/admin/audit');
    const table = await screen.findByTestId('audit-entries');
    expect(within(table).getByText('CERTIFICATE_REVOKED')).toBeInTheDocument();
    expect(within(table).getByText('Hodan Ali')).toBeInTheDocument();
    await userEvent.click(within(table).getByText(a.columns.details, { selector: 'summary' }));
    expect(within(table).getByText(/"reason": "ERROR"/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(a.filters.action), 'certificate_revoked');
    await userEvent.click(screen.getByRole('button', { name: a.filters.apply }));
    await expect
      .poll(() => calls.some((c) => c.key === 'GET /api/v1/audit?action=CERTIFICATE_REVOKED'))
      .toBe(true);

    await userEvent.click(screen.getByRole('button', { name: a.verify.button }));
    expect(
      await screen.findByText(a.verify.broken('7', a.verify.problems['ROW_CHANGED']!)),
    ).toBeInTheDocument();
  });

  it('should not offer chain verification to supervisors', async () => {
    mockApi({
      'POST /api/v1/auth/refresh': () => ({
        status: 200,
        body: sessionFor('SUPERVISOR', 'POLICE'),
      }),
      'GET /api/v1/notifications/unread-count': () => ({ status: 200, body: { unread: 0 } }),
      'GET /api/v1/audit': () => ({ status: 200, body: { items: [], nextCursor: null } }),
    });
    renderRoute('/officer/audit');
    expect(await screen.findByText(a.none)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: a.verify.button })).not.toBeInTheDocument();
  });
});
