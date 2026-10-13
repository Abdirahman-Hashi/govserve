import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';

export interface TestInfra {
  databaseUrl: string;
  redisUrl: string;
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  stop(): Promise<void>;
}

const API_ROOT = resolve(__dirname, '..');

/** Starts throwaway Postgres 16 + Redis 7 and applies all Prisma migrations. */
export async function startTestInfra(): Promise<TestInfra> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);
  const databaseUrl = postgres.getConnectionUri();
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
  return {
    databaseUrl,
    redisUrl: redis.getConnectionUrl(),
    postgres,
    redis,
    stop: async () => {
      await Promise.all([postgres.stop(), redis.stop()]);
    },
  };
}

/** A complete, valid environment for booting AppModule in tests. */
export function testEnv(
  infra: Pick<TestInfra, 'databaseUrl' | 'redisUrl'>,
): Record<string, string> {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    CORS_ORIGINS: 'http://localhost:5173',
    DATABASE_URL: infra.databaseUrl,
    REDIS_URL: infra.redisUrl,
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'test-bucket',
    S3_ACCESS_KEY_ID: 'test',
    S3_SECRET_ACCESS_KEY: 'test-secret',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    SMTP_FROM: 'GovServe <no-reply@govserve.local>',
    CLAMAV_HOST: 'localhost',
    CLAMAV_PORT: '3310',
  };
}
