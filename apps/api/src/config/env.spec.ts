import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from './env';

const valid = {
  CORS_ORIGINS: 'http://localhost:5173, http://localhost:4173',
  DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'docs',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'super-secret-value',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_FROM: 'GovServe <no-reply@govserve.local>',
  CLAMAV_HOST: 'localhost',
  CLAMAV_PORT: '3310',
  WEB_ORIGIN: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  PII_KEYS: `k1:${Buffer.alloc(32, 1).toString('base64')}`,
  BLIND_INDEX_KEY: Buffer.alloc(32, 2).toString('base64'),
  SIGNING_KEYS: `k1:${Buffer.alloc(48, 7).toString('base64')}`,
  CARD_WEBHOOK_SECRET: 'w'.repeat(32),
  PUBLIC_API_URL: 'http://localhost:3000',
};

describe('loadEnv', () => {
  it('should parse and apply defaults when the environment is valid', () => {
    const env = loadEnv(valid);
    expect(env.API_PORT).toBe(3000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'http://localhost:4173']);
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
  });

  it('should fail fast naming the variable when one is missing', () => {
    const { DATABASE_URL: _omit, ...missing } = valid;
    expect(() => loadEnv(missing)).toThrow(/DATABASE_URL/);
  });

  it('should not echo secret values when validation fails', () => {
    const invalid = { ...valid, S3_ACCESS_KEY_ID: '', SMTP_PORT: 'nope' };
    expect(() => loadEnv(invalid)).toThrow(/S3_ACCESS_KEY_ID[\s\S]*SMTP_PORT/);
    expect(() => loadEnv(invalid)).not.toThrow(/super-secret-value/);
  });

  it('should parse the PII key ring when keys are well formed', () => {
    const env = loadEnv({
      ...valid,
      PII_KEYS: `k2:${Buffer.alloc(32, 3).toString('base64')},k1:${Buffer.alloc(32, 1).toString('base64')}`,
    });
    expect(env.PII_KEYS.map((k) => k.id)).toEqual(['k2', 'k1']);
  });

  it('should reject a PII key that is not 32 bytes', () => {
    expect(() =>
      loadEnv({ ...valid, PII_KEYS: `k1:${Buffer.alloc(16).toString('base64')}` }),
    ).toThrow(/PII_KEYS/);
  });

  it('should refuse the no-op virus scanner in production', () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: 'production', VIRUS_SCANNER: 'noop' })).toThrow(
      /VIRUS_SCANNER/,
    );
    expect(
      loadEnv({ ...valid, NODE_ENV: 'development', VIRUS_SCANNER: 'noop' }).VIRUS_SCANNER,
    ).toBe('noop');
  });

  it('should refuse the mock card gateway in the production deployment', () => {
    expect(() => loadEnv({ ...valid, DEPLOY_ENV: 'production' })).toThrow(/CARD_GATEWAY/);
  });

  it('should size the database pool at 10 when DATABASE_POOL_MAX is unset and refuse values above 80', () => {
    expect(loadEnv(valid).DATABASE_POOL_MAX).toBe(10);
    expect(loadEnv({ ...valid, DATABASE_POOL_MAX: '40' }).DATABASE_POOL_MAX).toBe(40);
    expect(() => loadEnv({ ...valid, DATABASE_POOL_MAX: '500' })).toThrow(/DATABASE_POOL_MAX/);
  });

  it('should reject a short JWT secret', () => {
    expect(() => loadEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('should reject a non-postgres DATABASE_URL', () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: 'mysql://u:p@h/db' })).toThrow(/DATABASE_URL/);
  });

  describe('deployments (Phase 11)', () => {
    const prod = {
      ...valid,
      NODE_ENV: 'production',
      DEPLOY_ENV: 'staging',
      DATABASE_APP_URL: 'postgresql://govserve_app:pw@db:5432/govserve',
      METRICS_TOKEN: 'm'.repeat(32),
      TRUST_PROXY_HOPS: '2',
    };

    it('should refuse a production build that does not trust its proxies', () => {
      expect(() => loadEnv({ ...prod, TRUST_PROXY_HOPS: '0' })).toThrow(/TRUST_PROXY_HOPS/);
      expect(loadEnv(prod).TRUST_PROXY_HOPS).toBe(2);
      expect(loadEnv(valid).TRUST_PROXY_HOPS).toBe(0);
    });

    it('should run without the owner credentials when the app role is configured', () => {
      const { DATABASE_URL: _owner, ...noOwner } = prod;
      expect(loadEnv(noOwner).DATABASE_URL).toBeUndefined();
      expect(() => loadEnv({ ...noOwner, DATABASE_APP_URL: undefined })).toThrow(
        /DATABASE_APP_URL/,
      );
    });

    it('should require DEPLOY_ENV, an app role and a metrics token for production builds', () => {
      expect(() => loadEnv({ ...prod, DEPLOY_ENV: undefined })).toThrow(/DEPLOY_ENV/);
      expect(() => loadEnv({ ...prod, DATABASE_APP_URL: undefined })).toThrow(/DATABASE_APP_URL/);
      expect(() => loadEnv({ ...prod, METRICS_TOKEN: undefined })).toThrow(/METRICS_TOKEN/);
      expect(loadEnv(prod).DEPLOY_ENV).toBe('staging');
    });

    it('should allow the mock gateway on staging but not in production', () => {
      expect(loadEnv(prod).CARD_GATEWAY).toBe('mock');
      expect(() => loadEnv({ ...prod, DEPLOY_ENV: 'production' })).toThrow(/CARD_GATEWAY/);
      expect(
        loadEnv({ ...prod, DEPLOY_ENV: 'production', CARD_GATEWAY: 'disabled' }).CARD_GATEWAY,
      ).toBe('disabled');
    });

    it('should refuse disabled rate limiting when deployed to production', () => {
      const live = { ...prod, DEPLOY_ENV: 'production', CARD_GATEWAY: 'disabled' };
      expect(() => loadEnv({ ...live, RATE_LIMIT_ENABLED: 'false' })).toThrow(/RATE_LIMIT_ENABLED/);
      expect(loadEnv({ ...prod, RATE_LIMIT_ENABLED: 'false' }).RATE_LIMIT_ENABLED).toBe(false);
    });

    it('should read secrets from *_FILE without echoing them', () => {
      const dir = mkdtempSync(join(tmpdir(), 'env-'));
      const file = join(dir, 'webhook');
      writeFileSync(file, `${'s'.repeat(40)}\n`);
      const { CARD_WEBHOOK_SECRET: _drop, ...rest } = valid;
      expect(loadEnv({ ...rest, CARD_WEBHOOK_SECRET_FILE: file }).CARD_WEBHOOK_SECRET).toBe(
        's'.repeat(40),
      );
      // No file means unset: the required variable is reported by its own name.
      expect(() => loadEnv({ ...rest, CARD_WEBHOOK_SECRET_FILE: join(dir, 'missing') })).toThrow(
        /CARD_WEBHOOK_SECRET/,
      );
      rmSync(dir, { recursive: true });
    });

    it('should treat empty values and empty secret files as unset', () => {
      const dir = mkdtempSync(join(tmpdir(), 'env-'));
      writeFileSync(join(dir, 'pw'), '');
      const env = loadEnv({
        ...valid,
        SMTP_USER: '',
        SMTP_PASSWORD_FILE: join(dir, 'pw'),
        S3_PUBLIC_ENDPOINT: '',
      });
      expect([env.SMTP_USER, env.SMTP_PASSWORD, env.S3_PUBLIC_ENDPOINT]).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
      rmSync(dir, { recursive: true });
    });

    it('should need both SMTP credentials or neither', () => {
      expect(() => loadEnv({ ...valid, SMTP_USER: 'relay' })).toThrow(/SMTP_USER/);
      expect(loadEnv({ ...valid, SMTP_USER: 'relay', SMTP_PASSWORD: 'x' }).SMTP_USER).toBe('relay');
    });
  });
});
