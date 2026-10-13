import { type LoginResponse } from '@govserve/shared';
import request from 'supertest';
import { type ErrorEnvelope } from '../../src/common/filters/error-envelope.filter';
import { type Harness, send, signUpCitizen, startHarness, uniqueEmail } from './harness';

describe('Rate limits (integration, NFR-001)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness({ rateLimit: true });
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
});
