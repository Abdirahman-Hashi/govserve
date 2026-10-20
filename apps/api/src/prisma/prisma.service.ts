import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    // The restricted application role when configured (always in production), else the owner.
    super({
      adapter: new PrismaPg({
        connectionString: (config.DATABASE_APP_URL ?? config.DATABASE_URL)!,
        max: config.DATABASE_POOL_MAX,
      }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
