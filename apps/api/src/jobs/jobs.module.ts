import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { ConfigAdminModule } from '../config-admin/config-admin.module';
import {
  MAINTENANCE_QUEUE,
  MaintenanceProcessor,
  MaintenanceScheduler,
} from './maintenance.processor';
import { PurgeService } from './purge.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      // Pass options, not a client: BullMQ then owns its connections and closes them on
      // shutdown (an injected client is never closed and keeps the process alive).
      useFactory: (config: AppConfig) => ({
        connection: redisOptions(config.REDIS_URL),
        prefix: 'govserve',
      }),
    }),
    BullModule.registerQueue({ name: MAINTENANCE_QUEUE }),
    ApplicationsModule,
    ConfigAdminModule,
  ],
  providers: [PurgeService, MaintenanceProcessor, MaintenanceScheduler],
  exports: [PurgeService],
})
export class JobsModule {}

/** ioredis options from a redis:// or rediss:// URL. BullMQ needs maxRetriesPerRequest: null. */
export function redisOptions(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.username && { username: decodeURIComponent(u.username) }),
    ...(u.password && { password: decodeURIComponent(u.password) }),
    db: Number(u.pathname.slice(1) || 0),
    ...(u.protocol === 'rediss:' && { tls: {} }),
    maxRetriesPerRequest: null,
  };
}
