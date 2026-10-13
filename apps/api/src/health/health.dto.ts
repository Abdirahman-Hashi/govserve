import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { type HealthResponse } from '@govserve/shared';

/** Swagger mirror of the shared HealthResponseSchema. */
export class HealthResponseDto implements HealthResponse {
  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  status: 'ok' | 'error';

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string', enum: ['up', 'down'] },
    example: { database: 'up', redis: 'up' },
  })
  checks?: Record<string, 'up' | 'down'>;

  @ApiProperty({ example: '0.1.0' })
  version: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-13T12:00:00.000Z' })
  time: string;
}
