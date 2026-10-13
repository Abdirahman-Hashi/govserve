import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSession } from '../../auth/session-store';
import { t } from '../../strings';
import { mockApi, sessionFor } from '../../test/fetch-mock';
import { renderRoute } from '../../test/render';

const APP = '0199e0a8-7c1b-7d2e-9f00-00000000aaaa';
const item = (id: string, template: string, readAt: string | null, emailStatus = 'SENT') => ({
  id,
  template,
  vars: { referenceNo: 'GS-2026-000042', applicationId: APP },
  link: `/citizen/applications/${APP}`,
  emailStatus,
  createdAt: '2026-10-14T08:00:00.000Z',
  readAt,
});

describe('notifications', () => {
  afterEach(() => {
    clearSession();
    vi.unstubAllGlobals();
  });

  it('should show the unread badge and list notifications, then mark all read', async () => {
    let unread = 2;
    const { calls } = mockApi({
      'POST /api/v1/auth/refresh': () => ({ status: 200, body: sessionFor('CITIZEN') }),
      'GET /api/v1/notifications/unread-count': () => ({ status: 200, body: { unread } }),
      'GET /api/v1/notifications': () => ({
        status: 200,
        body: {
          items: [
            item('0199e0a8-7c1b-7d2e-9f00-000000000002', 'CERTIFICATE_ISSUED', unread ? null : 'x'),
            item('0199e0a8-7c1b-7d2e-9f00-000000000001', 'APPLICATION_SUBMITTED', null, 'SKIPPED'),
          ].map((i) => (unread ? i : { ...i, readAt: '2026-10-14T09:00:00.000Z' })),
          nextCursor: null,
        },
      }),
      'POST /api/v1/notifications/read-all': () => {
        unread = 0;
        return { status: 204 };
      },
    });
    renderRoute('/account/notifications');
    expect(await screen.findByTestId('unread-badge')).toHaveTextContent('2');
    expect(
      await screen.findByRole('link', { name: 'Certificate ready for GS-2026-000042' }),
    ).toHaveAttribute('href', `/citizen/applications/${APP}`);
    expect(screen.getByTestId('notifications')).toHaveTextContent(t.notifications.emailSkipped);
    await userEvent.click(screen.getByRole('button', { name: t.notifications.markAll }));
    expect(calls.some((c) => c.key === 'POST /api/v1/notifications/read-all')).toBe(true);
    await screen.findByRole('heading', { name: t.notifications.heading });
    await expect.poll(() => screen.queryByTestId('unread-badge')).toBeNull();
  });

  it('should turn optional emails off from the profile', async () => {
    const { calls } = mockApi({
      'POST /api/v1/auth/refresh': () => ({ status: 200, body: sessionFor('CITIZEN') }),
      'GET /api/v1/notifications/unread-count': () => ({ status: 200, body: { unread: 0 } }),
      'GET /api/v1/users/me': () => ({
        status: 200,
        body: {
          id: '0199e0a8-7c1b-7d2e-9f00-00000000cccc',
          email: 'amina@example.com',
          fullName: 'Amina Hassan',
          role: 'CITIZEN',
          departmentCode: null,
          emailVerified: true,
          phone: '+252612345678',
          nationalIdType: null,
          nationalIdMasked: null,
          dateOfBirth: null,
        },
      }),
      'GET /api/v1/account/notification-preferences': () => ({
        status: 200,
        body: { emailOptional: true },
      }),
      'PUT /api/v1/account/notification-preferences': (body) => ({ status: 200, body }),
    });
    renderRoute('/account/profile');
    const box = await screen.findByRole('checkbox', { name: t.notifications.prefs.optional });
    await expect.poll(() => (box as HTMLInputElement).disabled).toBe(false);
    await userEvent.click(box);
    expect(await screen.findByText(new RegExp(t.notifications.prefs.saved))).toBeInTheDocument();
    expect(calls.find((c) => c.key.startsWith('PUT'))?.body).toEqual({ emailOptional: false });
  });
});
