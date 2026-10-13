import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HealthResponseSchema } from '@govserve/shared';
import request from 'supertest';
import { type App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { type ErrorEnvelope } from '../../src/common/filters/error-envelope.filter';
import { PrismaService } from '../../src/prisma/prisma.service';
import { startTestInfra, testEnv, type TestInfra } from '../testcontainers';

describe('Health and readiness (integration)', () => {
  let infra: TestInfra;
  let app: INestApplication;
  const http = (): App => app.getHttpServer() as App;

  beforeAll(async () => {
    infra = await startTestInfra();
    Object.assign(process.env, testEnv(infra));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await infra?.stop();
  });

  it('should apply the baseline migration extensions when migrations run', async () => {
    const rows = await app.get(PrismaService).$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname IN ('citext', 'pg_trgm', 'pgcrypto') ORDER BY extname`;
    expect(rows.map((r) => r.extname)).toEqual(['citext', 'pg_trgm', 'pgcrypto']);
  });

  it('should return 200 with a request ID when /health is called', async () => {
    const res = await request(http()).get('/health').expect(200);
    expect(HealthResponseSchema.parse(res.body).status).toBe('ok');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('should return 200 when Postgres and Redis are reachable', async () => {
    const res = await request(http()).get('/ready').expect(200);
    expect(HealthResponseSchema.parse(res.body).checks).toEqual({ database: 'up', redis: 'up' });
  });

  it('should return the error envelope when a route does not exist', async () => {
    const res = await request(http()).get('/api/v1/does-not-exist');
    const body = res.body as ErrorEnvelope;
    expect(res.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('should return 503 when Redis goes down', async () => {
    await infra.redis.stop();
    const res = await request(http()).get('/ready').expect(503);
    expect(HealthResponseSchema.parse(res.body)).toMatchObject({
      status: 'error',
      checks: { database: 'up', redis: 'down' },
    });
  });
});
