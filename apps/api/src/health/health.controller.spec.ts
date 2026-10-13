import { type Response } from 'express';
import { HealthResponseSchema } from '@govserve/shared';
import { HealthController } from './health.controller';
import { type HealthService } from './health.service';

const now = '2026-10-13T12:00:00.000Z';

function controllerWith(ready: Awaited<ReturnType<HealthService['ready']>>): HealthController {
  const service = {
    live: () => ({ status: 'ok', version: 'test', time: now }),
    ready: () => Promise.resolve(ready),
  } as unknown as HealthService;
  return new HealthController(service);
}

function fakeResponse(): Response & { statusCode: number } {
  const res = { statusCode: 200, status: (code: number) => ((res.statusCode = code), res) };
  return res as unknown as Response & { statusCode: number };
}

describe('HealthController', () => {
  it('should return a schema-valid ok response when live is called', () => {
    const body = controllerWith({ status: 'ok', version: 'test', time: now }).live();
    expect(HealthResponseSchema.parse(body).status).toBe('ok');
  });

  it('should keep 200 when every dependency is up', async () => {
    const res = fakeResponse();
    const ok = {
      status: 'ok' as const,
      version: 'test',
      time: now,
      checks: { database: 'up' as const, redis: 'up' as const },
    };
    await controllerWith(ok).ready(res);
    expect(res.statusCode).toBe(200);
  });

  it('should return 503 when a dependency is down', async () => {
    const res = fakeResponse();
    const down = {
      status: 'error' as const,
      version: 'test',
      time: now,
      checks: { database: 'up' as const, redis: 'down' as const },
    };
    const body = await controllerWith(down).ready(res);
    expect(res.statusCode).toBe(503);
    expect(HealthResponseSchema.parse(body).checks).toEqual({ database: 'up', redis: 'down' });
  });
});
