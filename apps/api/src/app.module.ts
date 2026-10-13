import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ErrorEnvelopeFilter } from './common/filters/error-envelope.filter';
import { DenyByDefaultGuard } from './common/guards/deny-by-default.guard';
import { APP_CONFIG, type AppConfig, ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { LoggerModule } from './logging/logger.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    // In-memory store for now; Redis-backed storage when the API runs on more than one instance.
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => [{ ttl: 60_000, limit: config.RATE_LIMIT_PER_MINUTE }],
    }),
    PrismaModule,
    RedisModule,
    HealthModule,
  ],
  providers: [
    // Order matters: rate limiting runs before the authentication check.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: DenyByDefaultGuard },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
  ],
})
export class AppModule {}
