import { type INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from './config/config.module';
import { REQUEST_ID_HEADER } from './logging/logger.module';
import { httpMetrics } from './metrics/http-metrics.middleware';
import { MetricsService } from './metrics/metrics.service';
import { setupSwagger } from './swagger';

export const API_PREFIX = 'api/v1';

/** /api/v1 for the API; liveness/readiness probes and the Prometheus scrape stay at the root. */
export function applyGlobalPrefix(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'ready', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
    ],
  });
}

/** HTTP pipeline shared by main.ts and integration tests so both run the same stack. */
export function configureApp(app: INestApplication): void {
  const config = app.get<AppConfig>(APP_CONFIG);

  app.useLogger(app.get(Logger));
  app.use(httpMetrics(app.get(MetricsService)));
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.CORS_ORIGINS,
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER],
  });
  applyGlobalPrefix(app);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
  setupSwagger(app);
}
