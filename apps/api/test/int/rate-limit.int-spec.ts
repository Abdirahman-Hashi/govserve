import { type LoginResponse } from '@govserve/shared';
import request from 'supertest';
import { type ErrorEnvelope } from '../../src/common/filters/error-envelope.filter';
import {
  bearer,
  type Harness,
  PASSWORD,
  send,
  signUpCitizen,
  startHarness,
  uniqueEmail,
} from './harness';

describe('Rate limits (integration, NFR-001)', () => {
  let h: Harness;

  beforeAll(async () => {
    // One trusted proxy hop: X-Forwarded-For stands in for the client address behind nginx.
    h = await startHarness({ rateLimit: true, env: { TRUST_PROXY_HOPS: '1' } });
  });

  afterAll(async () => {
    await h?.close();
  });

  it('should allow frequent session refreshes but throttle password guessing', async () => {
    const { jar } = await signUpCitizen(h, uniqueEmail('limits'));

    // Refresh runs on every page load; 15 in a minute (e.g. several tabs) must all work.
    for (let i = 0; i < 15; i++) {
      const res = await send(jar, request(h.http()).post('/api/v1/auth/refresh'));
      expect(res.status).toBe(200);
    }

    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await request(h.http())
        .post('/api/v1/auth/login')
        .send({ email: uniqueEmail('guess'), password: 'not the password' });
      statuses.push(res.status);
      if (res.status === 429) expect((res.body as ErrorEnvelope).error.code).toBe('RATE_LIMITED');
      else
        expect((res.body as LoginResponse & ErrorEnvelope).error.code).toBe('INVALID_CREDENTIALS');
    }
    // Limits are per endpoint and IP: 10 login attempts a minute, then 429.
    expect(statuses.filter((s) => s === 401)).toHaveLength(10);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('should count signed-in requests per account when many citizens share one IP', async () => {
    const a = await signUpCitizen(h, uniqueEmail('nat-a'));
    const b = await signUpCitizen(h, uniqueEmail('nat-b'));
    const badge = (session: typeof a.session) =>
      request(h.http())
        .get('/api/v1/notifications/unread-count')
        .set(bearer(session))
        .set('X-Forwarded-For', '203.0.113.50');
    for (let i = 0; i < 100; i++) expect((await badge(a.session)).status).toBe(200);
    expect((await badge(a.session)).status).toBe(429);
    // Another citizen behind the same carrier NAT is not affected.
    expect((await badge(b.session)).status).toBe(200);
  });

  it('should count session refreshes per session when citizens share one IP', async () => {
    const a = await signUpCitizen(h, uniqueEmail('nat-ra'));
    const b = await signUpCitizen(h, uniqueEmail('nat-rb'));
    const refresh = (jar: typeof a.jar) =>
      send(
        jar,
        request(h.http()).post('/api/v1/auth/refresh').set('X-Forwarded-For', '203.0.113.60'),
      );
    for (let i = 0; i < 60; i++) expect((await refresh(a.jar)).status).toBe(200);
    expect((await refresh(a.jar)).status).toBe(429);
    expect((await refresh(b.jar)).status).toBe(200);
  });

  it('should never throttle cookieless refreshes when anonymous visitors share one IP', async () => {
    const statuses = new Set<number>();
    for (let i = 0; i < 80; i++) {
      const res = await request(h.http())
        .post('/api/v1/auth/refresh')
        .set('X-Forwarded-For', '203.0.113.80');
      statuses.add(res.status);
    }
    expect([...statuses]).toEqual([401]);
  });

  it('should limit sign-in per client address when requests come through the proxy', async () => {
    const login = (ip: string) =>
      request(h.http())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: uniqueEmail('guess'), password: 'not the password' });
    for (let i = 0; i < 10; i++) expect((await login('203.0.113.70')).status).toBe(401);
    expect((await login('203.0.113.70')).status).toBe(429);
    expect((await login('203.0.113.71')).status).toBe(401);
  });

  it('should record the client address from the proxy when it writes audit rows', async () => {
    const email = uniqueEmail('audit-ip');
    await request(h.http())
      .post('/api/v1/auth/register')
      .set('X-Forwarded-For', '198.51.100.9')
      .send({ fullName: 'Amina Hassan', email, phone: '+252 61 234 5678', password: PASSWORD })
      .expect(202);
    const user = await h.prisma.user.findUniqueOrThrow({ where: { email } });
    const row = await h.prisma.auditLog.findFirstOrThrow({
      where: { entityId: user.id, action: 'USER_REGISTERED' },
    });
    expect(row.ip).toBe('198.51.100.9');
  });
});
