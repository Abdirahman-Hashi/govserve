import { vi } from 'vitest';

/** `delayMs` holds the response back, to test what the UI does while a request is in flight. */
type Handler = (body: unknown) => { status: number; body?: unknown; delayMs?: number };

/** Routes fetch calls by "METHOD path" to handlers; unknown routes return 404. */
export function mockApi(routes: Record<string, Handler>) {
  const calls: { key: string; body: unknown }[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const key = `${init?.method ?? 'GET'} ${url}`;
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ key, body });
    const handler = routes[key];
    const res = handler
      ? handler(body)
      : { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
    const response = () =>
      new Response(res.body === undefined ? null : JSON.stringify(res.body), {
        status: res.status,
      });
    if (!res.delayMs) return Promise.resolve(response());
    return new Promise<Response>((done) => setTimeout(() => done(response()), res.delayMs));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export const READY_OK = () => ({
  status: 200,
  body: { status: 'ok', version: 'test', time: '2026-10-13T12:00:00.000Z' },
});
export const NO_SESSION = () => ({
  status: 401,
  body: { error: { code: 'SESSION_EXPIRED', message: 'Please sign in again' } },
});

export function sessionFor(
  role: 'CITIZEN' | 'OFFICER' | 'SUPERVISOR' | 'ADMIN',
  departmentCode: string | null = null,
) {
  return {
    accessToken: 'jwt',
    expiresIn: 900,
    user: {
      id: '0199e0a8-7c1b-7d2e-9f00-1a2b3c4d5e6f',
      email: 'user@example.com',
      fullName: 'Test User',
      role,
      departmentCode,
      emailVerified: true,
    },
  };
}
