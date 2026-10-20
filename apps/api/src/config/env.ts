import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((v) => v === 'true');

/** Every environment variable the API reads. Documented in /.env.example. */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Which deployment this is. Production-only refusals (mock gateway, e2e fixtures) key on this, so
  // staging can run production builds with test adapters. Required when NODE_ENV=production.
  DEPLOY_ENV: z.enum(['local', 'staging', 'production']).default('local'),
  APP_VERSION: z.string().min(1).default('dev'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGINS: z
    .string()
    .min(1)
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(100),
  // Ceiling per client IP across all routes, sized for many users behind one carrier NAT.
  RATE_LIMIT_PER_IP_PER_MINUTE: z.coerce.number().int().positive().default(1200),
  // Reverse proxies in front of the API whose X-Forwarded-For is trusted (Caddy → nginx = 2). With
  // 0, the client IP is the socket peer: right for the dev server, wrong behind the proxies, where
  // every request would share nginx's IP (rate limits and audit IPs). Production builds need ≥ 1.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  // Disable only in automated tests that exercise many auth calls from one IP.
  RATE_LIMIT_ENABLED: booleanString.default(true),
  // The owner, used by migrations. Deployed API containers do not get it (ADR-0010): they connect
  // with DATABASE_APP_URL as a member of govserve_app_rw (INSERT/SELECT only on audit tables).
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  DATABASE_APP_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  // Connections per API process (the pg driver's default, 10). Raising it did not help write bursts
  // in the load test, which queue on the audit chain instead (docs/perf/load-test.md). Keep well
  // under Postgres max_connections (100) across the API, jobs and backups.
  DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(80).default(10),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: booleanString.default(false),
  // Host browsers use for pre-signed URLs when it differs from the API's internal endpoint.
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  // clamav in every real environment; noop only for local development and tests.
  VIRUS_SCANNER: z.enum(['clamav', 'noop']).default('clamav'),
  // Ed25519 signing keys for receipts/certificates: "keyId:base64(PKCS#8 DER)", comma-separated.
  // The first key signs; the others are retired but still verify (ADR-0006).
  SIGNING_KEYS: z
    .string()
    .min(1)
    .transform((v, ctx) =>
      v.split(',').map((pair) => {
        const [id, b64] = pair.trim().split(':');
        const der = Buffer.from(b64 ?? '', 'base64');
        if (!id || !/^[A-Za-z0-9._-]{1,40}$/.test(id) || der.length < 40) {
          ctx.addIssue({
            code: 'custom',
            message: 'each entry must be keyId:base64(PKCS#8 DER Ed25519 private key)',
          });
        }
        return { id: id ?? '', der };
      }),
    ),
  // Card gateway adapter: "mock" (local, staging) or "disabled" (no card payments) until a real
  // gateway is chosen (O-7). The mock is refused when DEPLOY_ENV=production.
  CARD_GATEWAY: z.enum(['mock', 'disabled']).default('mock'),
  CARD_WEBHOOK_SECRET: z.string().min(32, 'must be at least 32 characters'),
  // Public base URL of this API (webhook target for the mock gateway, links in PDFs).
  PUBLIC_API_URL: z.url(),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_FROM: z.string().min(3),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  // true: implicit TLS (port 465). Otherwise SMTP_REQUIRE_TLS forces STARTTLS.
  SMTP_SECURE: booleanString.default(false),
  SMTP_REQUIRE_TLS: booleanString.default(false),
  // Bearer token Prometheus sends to /metrics. Required in production.
  METRICS_TOKEN: z.string().min(32, 'must be at least 32 characters').optional(),
  // Notification delivery (FR-102): attempts before dead-letter, first retry delay, outbox poll.
  NOTIFY_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  NOTIFY_BACKOFF_MS: z.coerce.number().int().min(10).default(30_000),
  // FR-112: CSV export row cap (lowered in tests).
  SEARCH_EXPORT_CAP: z.coerce.number().int().min(1).max(50_000).default(50_000),
  OUTBOX_POLL_MS: z.coerce.number().int().min(200).default(5_000),
  CLAMAV_HOST: z.string().min(1),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535),
  // Public URL of the web app: links in emails and the Origin check on cookie endpoints.
  WEB_ORIGIN: z.url(),
  // false only for plain-http local setups whose browser rejects Secure cookies.
  COOKIE_SECURE: booleanString.default(true),
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  // "keyId:base64(32 bytes)" pairs, comma-separated. The first key encrypts; all decrypt.
  PII_KEYS: z
    .string()
    .min(1)
    .transform((v, ctx) => {
      const keys = v.split(',').map((pair) => {
        const [id, b64] = pair.trim().split(':');
        const key = Buffer.from(b64 ?? '', 'base64');
        if (!id || key.length !== 32) {
          ctx.addIssue({ code: 'custom', message: 'each entry must be keyId:base64 of 32 bytes' });
        }
        return { id: id ?? '', key };
      });
      return keys;
    }),
  // base64 of at least 32 bytes; HMAC key for blind indexes (separate from PII_KEYS).
  BLIND_INDEX_KEY: z
    .string()
    .transform((v) => Buffer.from(v, 'base64'))
    .refine((b) => b.length >= 32, 'must be base64 of at least 32 bytes'),
});

export type Env = z.infer<typeof EnvSchema>;

/** Rules that span several variables. */
function crossCheck(env: Env): string[] {
  const problems: string[] = [];
  if (env.NODE_ENV === 'production' && env.DEPLOY_ENV === 'local') {
    problems.push('  - DEPLOY_ENV: set "staging" or "production" for production builds');
  }
  if (env.NODE_ENV === 'production' && env.VIRUS_SCANNER !== 'clamav') {
    problems.push('  - VIRUS_SCANNER: must be "clamav" in production builds');
  }
  if (!env.DATABASE_URL && !env.DATABASE_APP_URL) {
    problems.push('  - DATABASE_APP_URL: required (or DATABASE_URL for local development)');
  }
  if (env.NODE_ENV === 'production') {
    if (!env.DATABASE_APP_URL) {
      problems.push(
        '  - DATABASE_APP_URL: production builds must connect as the restricted application role',
      );
    } else if (
      env.DATABASE_URL &&
      new URL(env.DATABASE_URL).username === new URL(env.DATABASE_APP_URL).username
    ) {
      problems.push(
        '  - DATABASE_APP_URL: production builds must connect as the restricted application role, not the owner',
      );
    }
    if (!env.METRICS_TOKEN) problems.push('  - METRICS_TOKEN: required in production builds');
  }
  if (env.DEPLOY_ENV === 'production' && env.CARD_GATEWAY === 'mock') {
    problems.push(
      '  - CARD_GATEWAY: the mock gateway cannot run in production (use "disabled" until O-7)',
    );
  }
  if (env.NODE_ENV === 'production' && env.TRUST_PROXY_HOPS === 0) {
    problems.push(
      '  - TRUST_PROXY_HOPS: production builds run behind the proxies; set it (2 for Caddy → nginx)',
    );
  }
  if (env.DEPLOY_ENV === 'production' && !env.RATE_LIMIT_ENABLED) {
    problems.push('  - RATE_LIMIT_ENABLED: rate limiting cannot be turned off in production');
  }
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) {
    problems.push('  - SMTP_USER / SMTP_PASSWORD: set both or neither');
  }
  return problems;
}

/**
 * Secrets can come as files (Docker secrets mounted at /run/secrets): `X_FILE=/run/secrets/x`
 * fills `X` when it is not set directly, so secrets never sit in the container environment.
 */
export function resolveFileSecrets(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...source };
  for (const key of Object.keys(EnvSchema.shape)) {
    // Compose passes unset optional settings as empty strings: treat them as unset.
    if (out[key] === '') delete out[key];
    const file = source[`${key}_FILE`];
    if (!file || out[key] !== undefined) continue;
    // Compose creates no file for an empty secret: unset, so a required one fails by its own name.
    if (!existsSync(file)) continue;
    try {
      const value = readFileSync(file, 'utf8').replace(/\r?\n$/, '');
      if (value !== '') out[key] = value;
    } catch {
      throw new Error(
        `Invalid environment configuration:\n  - ${key}_FILE: cannot read the secret file`,
      );
    }
  }
  return out;
}

/**
 * Validates the environment and fails fast. The error names the offending
 * variables but never echoes their values (they may be secrets).
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(resolveFileSecrets(source));
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const cross = crossCheck(result.data);
  if (cross.length > 0) throw new Error(`Invalid environment configuration:\n${cross.join('\n')}`);
  return result.data;
}
