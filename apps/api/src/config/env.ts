import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((v) => v === 'true');

/** Every environment variable the API reads. Documented in /.env.example. */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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
  // Disable only in automated tests that exercise many auth calls from one IP.
  RATE_LIMIT_ENABLED: booleanString.default(true),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // Runtime connection as a member of govserve_app_rw (INSERT/SELECT only on audit_log, ADR-0010).
  // DATABASE_URL stays the owner, used by migrations. Required to differ in production.
  DATABASE_APP_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
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
  // Card gateway adapter. Only "mock" exists until a real gateway is chosen (refused in production).
  CARD_GATEWAY: z.enum(['mock']).default('mock'),
  CARD_WEBHOOK_SECRET: z.string().min(32, 'must be at least 32 characters'),
  // Public base URL of this API (webhook target for the mock gateway, links in PDFs).
  PUBLIC_API_URL: z.url(),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_FROM: z.string().min(3),
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
  if (env.NODE_ENV === 'production' && env.VIRUS_SCANNER !== 'clamav') {
    problems.push('  - VIRUS_SCANNER: must be "clamav" in production');
  }
  if (env.NODE_ENV === 'production') {
    const owner = new URL(env.DATABASE_URL).username;
    const app = env.DATABASE_APP_URL ? new URL(env.DATABASE_APP_URL).username : owner;
    if (app === owner) {
      problems.push(
        '  - DATABASE_APP_URL: production must connect as the restricted application role, not the owner',
      );
    }
  }
  if (env.NODE_ENV === 'production' && env.CARD_GATEWAY === 'mock') {
    problems.push('  - CARD_GATEWAY: the mock gateway cannot run in production');
  }
  return problems;
}

/**
 * Validates the environment and fails fast. The error names the offending
 * variables but never echoes their values (they may be secrets).
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
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
