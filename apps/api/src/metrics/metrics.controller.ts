import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Headers, Inject, Res, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { type Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { MetricsService } from './metrics.service';

/**
 * Prometheus scrape endpoint, outside /api/v1 and never routed by the web proxy or the edge.
 * When METRICS_TOKEN is set (always in production) the scraper must send it as a bearer token.
 */
@ApiExcludeController()
@Public()
@SkipThrottle({ default: true, ip: true })
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  async scrape(
    @Headers('authorization') auth: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const token = this.config.METRICS_TOKEN;
    if (token) {
      const given = Buffer.from(auth?.replace(/^Bearer /, '') ?? '');
      const expected = Buffer.from(token);
      if (given.length !== expected.length || !timingSafeEqual(given, expected))
        throw new UnauthorizedException();
    }
    res.setHeader('Content-Type', this.metrics.registry.contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.send(await this.metrics.registry.metrics());
  }
}
