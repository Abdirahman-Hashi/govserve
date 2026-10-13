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

  it('should reject a non-postgres DATABASE_URL', () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: 'mysql://u:p@h/db' })).toThrow(/DATABASE_URL/);
  });
});
