import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ErrorEnvelopeFilter } from './common/filters/error-envelope.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { APP_CONFIG, type AppConfig, ConfigModule } from './config/config.module';
import { ApplicationsModule } from './applications/applications.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CatalogueModule } from './catalogue/catalogue.module';
import { ConfigAdminModule } from './config-admin/config-admin.module';
import { CryptoModule } from './crypto/crypto.module';
import { DocumentsModule } from './documents/documents.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { UsersModule } from './users/users.module';
import { LoggerModule } from './logging/logger.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    // In-memory store for now; Redis-backed storage when the API runs on more than one instance.
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [{ ttl: 60_000, limit: config.RATE_LIMIT_PER_MINUTE }],
        skipIf: () => !config.RATE_LIMIT_ENABLED,
      }),
    }),
    PrismaModule,
    RedisModule,
    CryptoModule,
    StorageModule,
    AuditModule,
    NotificationsModule,
    AuthModule,
    UsersModule,
    CatalogueModule,
    ConfigAdminModule,
    ApplicationsModule,
    DocumentsModule,
    PaymentsModule,
    JobsModule,
    HealthModule,
  ],
  providers: [
    // Order matters: rate limiting, then authentication, then the role decision (deny by default).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
  ],
})
export class AppModule {}
