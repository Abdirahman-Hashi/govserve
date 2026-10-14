import { type ApplicationDetail } from '@govserve/shared';
import request from 'supertest';
import { type ErrorEnvelope } from '../../src/common/filters/error-envelope.filter';
import { bearer, type Harness, signUpCitizen, startHarness } from './harness';

const api = '/api/v1';
const TOKEN = 'm'.repeat(40);

/** Production-shaped settings: card payments disabled (O-7) and a protected metrics endpoint. */
describe('Operations: metrics and a disabled card gateway (integration)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness({ env: { CARD_GATEWAY: 'disabled', METRICS_TOKEN: TOKEN } });
  });

  afterAll(async () => {
    await h?.close();
  });

  const scrape = async () =>
    (await request(h.http()).get('/metrics').set('Authorization', `Bearer ${TOKEN}`).expect(200))
      .text;
  const sample = (text: string, metric: string) =>
    text
      .split('\n')
      .filter((l) => l.startsWith(metric))
      .reduce((sum, l) => sum + Number(l.split(' ').at(-1)), 0);

  it('should protect /metrics with the bearer token and keep it out of the API', async () => {
    await request(h.http()).get('/metrics').expect(401);
    await request(h.http()).get('/metrics').set('Authorization', 'Bearer wrong').expect(401);
    const text = await scrape();
    expect(text).toContain('govserve_build_info');
    expect(text).toMatch(/bullmq_jobs\{queue="notifications",state="waiting"\}/);
    await request(h.http()).get(`${api}/metrics`).expect(404);
  });

  it('should count requests by matched route and status, never by raw URL', async () => {
    const before = sample(
      await scrape(),
      'http_requests_total{method="GET",route="unmatched",status="404"}',
    );
    await request(h.http()).get(`${api}/no-such-thing/123`).expect(404);
    const text = await scrape();
    expect(sample(text, 'http_requests_total{method="GET",route="unmatched",status="404"}')).toBe(
      before + 1,
    );
    expect(text).not.toContain('no-such-thing');
    await request(h.http()).get(`${api}/verify/r/R-2026-999999`).expect(404);
    expect(await scrape()).toContain('route="/api/v1/verify/r/:receiptNo",status="404"');
  });

  it('should count rejected card webhooks', async () => {
    const before = sample(await scrape(), 'payment_webhook_failures_total{reason="signature"}');
    await request(h.http())
      .post(`${api}/payments/webhooks/card`)
      .set('Content-Type', 'application/json')
      .send('{}')
      .expect(401);
    expect(sample(await scrape(), 'payment_webhook_failures_total{reason="signature"}')).toBe(
      before + 1,
    );
  });

  it('should hide and refuse card payments when the gateway is disabled', async () => {
    const { session } = await signUpCitizen(h);
    const app = (
      await request(h.http())
        .post(`${api}/applications`)
        .set(bearer(session))
        .send({ serviceCode: 'PROOF_OF_ADDRESS' })
        .expect(201)
    ).body as ApplicationDetail;
    expect(app.cardPaymentsEnabled).toBe(false);
    const res = await request(h.http())
      .post(`${api}/applications/${app.id}/payments/card`)
      .set(bearer(session))
      .set('Idempotency-Key', 'key-disabled-1')
      .expect(409);
    expect((res.body as ErrorEnvelope).error.code).toBe('CARD_UNAVAILABLE');
    await request(h.http()).get(`${api}/mock-gateway/checkout/anything`).expect(404);
  });
});
