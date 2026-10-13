import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSession } from '../../auth/session-store';
import { t } from '../../strings';
import { mockApi, NO_SESSION, READY_OK, sessionFor } from '../../test/fetch-mock';
import { renderRoute } from '../../test/render';

describe('auth pages', () => {
  afterEach(() => {
    clearSession();
    vi.unstubAllGlobals();
  });

  it('should show field errors from the shared schema without calling the API', async () => {
    const { calls } = mockApi({ 'POST /api/v1/auth/refresh': NO_SESSION });
    renderRoute('/register');
    await userEvent.click(await screen.findByRole('button', { name: t.register.submit }));
    expect(await screen.findByText('Enter your full name')).toBeInTheDocument();
    expect(screen.getByLabelText(t.fields.email)).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((c) => c.key === 'POST /api/v1/auth/register')).toBe(false);
  });

  it('should ask staff for the emailed code and then land on the work queue', async () => {
    const { calls } = mockApi({
      'POST /api/v1/auth/refresh': NO_SESSION,
      'GET /ready': READY_OK,
      'POST /api/v1/auth/login': () => ({
        status: 200,
        body: { status: 'OTP_REQUIRED', challengeId: '0199e0a8-7c1b-7d2e-9f00-1a2b3c4d5e6f' },
      }),
      'POST /api/v1/auth/login/otp': () => ({ status: 200, body: sessionFor('OFFICER', 'POLICE') }),
    });
    renderRoute('/login');
    await userEvent.type(await screen.findByLabelText(t.fields.email), 'officer@bra.gov.so');
    await userEvent.type(screen.getByLabelText(t.fields.password), 'mango river lantern 42');
    await userEvent.click(screen.getByRole('button', { name: t.login.submit }));

    await userEvent.type(await screen.findByLabelText(t.fields.code), '123456');
    await userEvent.click(screen.getByRole('button', { name: t.login.otpSubmit }));

    expect(await screen.findByRole('heading', { name: t.nav.officer })).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/v1/auth/login/otp')?.body).toEqual({
      challengeId: '0199e0a8-7c1b-7d2e-9f00-1a2b3c4d5e6f',
      code: '123456',
    });
  });

  it('should show the API error message when sign-in fails', async () => {
    mockApi({
      'POST /api/v1/auth/refresh': NO_SESSION,
      'POST /api/v1/auth/login': () => ({
        status: 401,
        body: { error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } },
      }),
    });
    renderRoute('/login');
    await userEvent.type(await screen.findByLabelText(t.fields.email), 'a@b.so');
    await userEvent.type(screen.getByLabelText(t.fields.password), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: t.login.submit }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
  });
});
