import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../strings';
import { mockApi, NO_SESSION, READY_OK, sessionFor } from '../test/fetch-mock';
import { renderRoute } from '../test/render';
import { clearSession } from './session-store';

describe('route guards', () => {
  afterEach(() => {
    clearSession();
    vi.unstubAllGlobals();
  });

  it('should send an anonymous visitor to sign in with a return path', async () => {
    mockApi({ 'POST /api/v1/auth/refresh': NO_SESSION, 'GET /ready': READY_OK });
    renderRoute('/admin/staff');
    expect(await screen.findByRole('heading', { name: t.login.heading })).toBeInTheDocument();
  });

  it('should show not-available when a citizen opens an admin page', async () => {
    mockApi({ 'POST /api/v1/auth/refresh': () => ({ status: 200, body: sessionFor('CITIZEN') }) });
    renderRoute('/admin');
    expect(await screen.findByRole('heading', { name: t.forbidden.heading })).toBeInTheDocument();
  });

  it('should open the staff page for an admin', async () => {
    mockApi({
      'POST /api/v1/auth/refresh': () => ({ status: 200, body: sessionFor('ADMIN') }),
      'GET /api/v1/staff': () => ({ status: 200, body: [] }),
    });
    renderRoute('/admin/staff');
    expect(await screen.findByRole('heading', { name: t.staff.heading })).toBeInTheDocument();
    expect(await screen.findByText(t.staff.empty)).toBeInTheDocument();
  });
});
