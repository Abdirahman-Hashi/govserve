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
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: booleanString.default(false),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_FROM: z.string().min(3),
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
  return result.data;
}
