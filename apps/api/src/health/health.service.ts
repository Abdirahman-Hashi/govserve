import { Inject, Injectable } from '@nestjs/common';
import { type HealthResponse } from '@govserve/shared';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';

const CHECK_TIMEOUT_MS = 2000;

async function probe(check: () => Promise<unknown>): Promise<'up' | 'down'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([check(), timeout]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Liveness: the process is up. No dependency checks. */
  live(): HealthResponse {
    return { status: 'ok', version: this.config.APP_VERSION, time: new Date().toISOString() };
  }

  /** Readiness: Postgres and Redis respond. */
  async ready(): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([
      probe(() => this.prisma.$queryRaw`SELECT 1`),
      probe(async () => {
        if (this.redis.status === 'wait' || this.redis.status === 'end') await this.redis.connect();
        return this.redis.ping();
      }),
    ]);
    const checks = { database, redis };
    const ok = Object.values(checks).every((c) => c === 'up');
    return { ...this.live(), status: ok ? 'ok' : 'error', checks };
  }
}
