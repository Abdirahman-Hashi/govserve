import { randomUUID } from 'node:crypto';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from '../config/config.module';

export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Reuse a well-formed incoming request ID, otherwise mint one; echo it on the response. */
export function requestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

/** Never log credentials, tokens, OTPs or PII (CLAUDE.md, NFR-003). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  ...[
    'password',
    'token',
    'accessToken',
    'refreshToken',
    'otp',
    'code',
    'nationalId',
    'phone',
    'dateOfBirth',
    'secret',
  ].flatMap((key) => [key, `*.${key}`]),
];

export const LoggerModule = PinoLoggerModule.forRootAsync({
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig) => ({
    pinoHttp: {
      level: config.LOG_LEVEL,
      genReqId: requestId,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      // Log only what is needed to trace a request; headers and query strings can carry PII.
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      autoLogging: { ignore: (req: IncomingMessage) => req.url === '/health' },
      transport:
        config.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { singleLine: true } }
          : undefined,
    },
  }),
});
