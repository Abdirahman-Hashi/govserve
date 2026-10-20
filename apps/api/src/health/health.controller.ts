import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { type HealthResponse } from '@govserve/shared';
import { type Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { HealthResponseDto } from './health.dto';
import { HealthService } from './health.service';

@ApiTags('health')
@Public()
@SkipThrottle({ default: true, ip: true })
@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('health')
  @ApiOperation({
    summary: 'Liveness probe',
    description: 'Public. Returns 200 while the process is running.',
  })
  @ApiOkResponse({ type: HealthResponseDto })
  live(): HealthResponse {
    return this.health.live();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe',
    description: 'Public. Returns 200 when Postgres and Redis respond, 503 otherwise.',
  })
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ type: HealthResponseDto })
  async ready(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const result = await this.health.ready();
    if (result.status !== 'ok') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
