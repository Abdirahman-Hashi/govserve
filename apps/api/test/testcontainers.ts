import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

export interface TestInfra {
  databaseUrl: string;
  redisUrl: string;
  s3Endpoint: string;
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  objectstore: StartedTestContainer;
  stop(): Promise<void>;
}

const S3_KEY = 'testaccess';
const S3_SECRET = 'testsecret123';
export const TEST_BUCKET = 'test-documents';

const API_ROOT = resolve(__dirname, '..');

/** Starts throwaway Postgres 16 + Redis 7 and applies all Prisma migrations. */
export async function startTestInfra(): Promise<TestInfra> {
  const [postgres, redis, objectstore] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
    new GenericContainer('rustfs/rustfs:1.0.1')
      .withCommand(['server', '--address', ':9000', '/data'])
      .withEnvironment({ RUSTFS_ACCESS_KEY: S3_KEY, RUSTFS_SECRET_KEY: S3_SECRET })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp('/health', 9000))
      .start(),
  ]);
  const s3Endpoint = `http://${objectstore.getHost()}:${objectstore.getMappedPort(9000)}`;
  const s3 = new S3Client({
    endpoint: s3Endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: S3_KEY, secretAccessKey: S3_SECRET },
  });
  await s3.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }));
  s3.destroy();
  const databaseUrl = postgres.getConnectionUri();
  for (const args of [
    ['exec', 'prisma', 'migrate', 'deploy'],
    ['run', 'db:seed'],
  ]) {
    execFileSync('pnpm', args, {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });
  }
  return {
    databaseUrl,
    redisUrl: redis.getConnectionUrl(),
    s3Endpoint,
    postgres,
    redis,
    objectstore,
    stop: async () => {
      await Promise.all([postgres.stop(), redis.stop(), objectstore.stop()]);
    },
  };
}

/** A complete, valid environment for booting AppModule in tests. */
export function testEnv(
  infra: Pick<TestInfra, 'databaseUrl' | 'redisUrl' | 's3Endpoint'>,
): Record<string, string> {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    VIRUS_SCANNER: 'noop',
    RATE_LIMIT_ENABLED: 'false',
    CORS_ORIGINS: 'http://localhost:5173',
    DATABASE_URL: infra.databaseUrl,
    REDIS_URL: infra.redisUrl,
    S3_ENDPOINT: infra.s3Endpoint,
    S3_REGION: 'us-east-1',
    S3_BUCKET: TEST_BUCKET,
    S3_ACCESS_KEY_ID: S3_KEY,
    S3_SECRET_ACCESS_KEY: S3_SECRET,
    S3_FORCE_PATH_STYLE: 'true',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    SMTP_FROM: 'GovServe <no-reply@govserve.local>',
    NOTIFY_ATTEMPTS: '3',
    NOTIFY_BACKOFF_MS: '50',
    OUTBOX_POLL_MS: '300',
    CLAMAV_HOST: 'localhost',
    CLAMAV_PORT: '3310',
    WEB_ORIGIN: 'http://localhost:5173',
    // Test runs use plain-http supertest; Secure cookies are still set and read by the API.
    COOKIE_SECURE: 'true',
    JWT_ACCESS_SECRET: randomBytes(32).toString('base64'),
    PII_KEYS: `test1:${randomBytes(32).toString('base64')}`,
    BLIND_INDEX_KEY: randomBytes(32).toString('base64'),
    SIGNING_KEYS: `test-1:${generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')}`,
    CARD_GATEWAY: 'mock',
    CARD_WEBHOOK_SECRET: randomBytes(32).toString('base64'),
    PUBLIC_API_URL: 'http://127.0.0.1:0',
  };
}
