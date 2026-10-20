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

  it('should wait for Retry-After and try again when the refresh is rate limited', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '3' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = refreshSession();
    await vi.advanceTimersByTimeAsync(2_900);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(await result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getAccessToken()).toBe('jwt-1');
    vi.useRealTimers();
  });

  it('should give up after two retries when the refresh stays rate limited', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response('{}', { status: 429, headers: { 'Retry-After': '1' } })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = refreshSession();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('should not retry when the server fails, since the token may already have rotated', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 503 })));
    vi.stubGlobal('fetch', fetchMock);
    expect(await refreshSession()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
