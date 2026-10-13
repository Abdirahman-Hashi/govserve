import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSession, getAccessToken, refreshSession } from './session-store';

const session = {
  accessToken: 'jwt-1',
  expiresIn: 900,
  user: {
    id: '0199e0a8-7c1b-7d2e-9f00-1a2b3c4d5e6f',
    email: 'a@b.so',
    fullName: 'A B',
    role: 'CITIZEN',
    departmentCode: null,
    emailVerified: true,
  },
};

describe('session store', () => {
  afterEach(() => {
    clearSession();
    vi.unstubAllGlobals();
  });

  it('should send only one refresh request when called concurrently', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(session), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const results = await Promise.all([refreshSession(), refreshSession(), refreshSession()]);
    expect(results).toEqual([true, true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe('jwt-1');
  });

  it('should clear the session when refresh fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 401 }))),
    );
    expect(await refreshSession()).toBe(false);
    expect(getAccessToken()).toBeNull();
  });
});
