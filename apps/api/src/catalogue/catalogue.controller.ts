import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  type CatalogueServiceDetail,
  CatalogueServiceDetailSchema,
  type CatalogueServiceSummary,
  CatalogueServiceSummarySchema,
  ServiceCodeSchema,
} from '@govserve/shared';
import { z } from 'zod';
import { Public } from '../common/decorators/public.decorator';
import { ApiZodResponse, ZodPipe } from '../common/zod';
import { CatalogueService } from './catalogue.service';

const SearchQuery = z.string().trim().max(100).optional();

@ApiTags('catalogue')
@Public()
@Controller('catalogue/services')
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Get()
  @ApiOperation({
    summary: 'List available services',
    description:
      'Public. Active services with a published version; optional text search on name and description.',
  })
  @ApiQuery({ name: 'q', required: false, example: 'police' })
  @ApiZodResponse(200, z.array(CatalogueServiceSummarySchema))
  list(@Query('q', new ZodPipe(SearchQuery)) q?: string): Promise<CatalogueServiceSummary[]> {
    return this.catalogue.listPublic(q);
  }

  @Get(':code')
  @ApiOperation({
    summary: 'Service details',
    description:
      'Public. The current published version: form definition, required documents, fee rule and target processing time.',
  })
  @ApiZodResponse(200, CatalogueServiceDetailSchema)
  @ApiResponse({ status: 404, description: 'NOT_FOUND (unknown, inactive or unpublished service)' })
  get(
    @Param('code', new ZodPipe(ServiceCodeSchema)) code: string,
  ): Promise<CatalogueServiceDetail> {
    return this.catalogue.getPublic(code);
  }
}
