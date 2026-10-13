import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  type AdminService,
  AdminServiceSchema,
  type CreateServiceRequest,
  CreateServiceRequestSchema,
  type ServiceVersion,
  ServiceVersionSchema,
  type UpdateServiceRequest,
  UpdateServiceRequestSchema,
  type UpdateVersionRequest,
  UpdateVersionRequestSchema,
} from '@govserve/shared';
import { z } from 'zod';
import { type AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ReqCtx, type RequestContext } from '../common/request-context';
import { ApiZodBody, ApiZodResponse, ZodPipe } from '../common/zod';
import { CatalogueService } from './catalogue.service';

const notEditable = { status: 409, description: 'VERSION_NOT_EDITABLE (only drafts can change)' };

@ApiTags('admin: catalogue')
@ApiBearerAuth()
@Roles('ADMIN')
@ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
@ApiResponse({ status: 403, description: 'FORBIDDEN (not an admin)' })
@Controller('admin')
export class AdminCatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Get('services')
  @ApiOperation({
    summary: 'List all services',
    description: 'Roles: ADMIN. Includes inactive services and version status.',
  })
  @ApiZodResponse(200, z.array(AdminServiceSchema))
  list(): Promise<AdminService[]> {
    return this.catalogue.listAdmin();
  }

  @Post('services')
  @ApiOperation({
    summary: 'Create a service',
    description:
      'Roles: ADMIN. Creates the service with an empty draft version 1. Code, department and certificate prefix cannot change later.',
  })
  @ApiZodBody(CreateServiceRequestSchema, {
    code: 'BUSINESS_PERMIT',
    departmentCode: 'ADDRESS',
    certificatePrefix: 'BUS',
    name: 'Business permit',
    description: 'Permit to operate a small business in Banadir.',
    active: false,
    slaWorkingDays: 10,
    inPersonStep: 'NONE',
    approvalMode: 'SINGLE',
    validityMonths: 12,
    subjectMode: 'SELF',
  })
  @ApiZodResponse(201, AdminServiceSchema)
  @ApiResponse({ status: 409, description: 'SERVICE_EXISTS' })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(CreateServiceRequestSchema)) body: CreateServiceRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<AdminService> {
    return this.catalogue.createService(user, body, ctx);
  }

  @Patch('services/:id')
  @ApiOperation({
    summary: 'Update a service',
    description: 'Roles: ADMIN. Audited with before/after values.',
  })
  @ApiZodBody(UpdateServiceRequestSchema, { slaWorkingDays: 7, active: true })
  @ApiZodResponse(200, AdminServiceSchema)
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(UpdateServiceRequestSchema)) body: UpdateServiceRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<AdminService> {
    return this.catalogue.updateService(user, id, body, ctx);
  }

  @Get('services/:id/versions')
  @ApiOperation({
    summary: 'List versions of a service',
    description: 'Roles: ADMIN. Newest first.',
  })
  @ApiZodResponse(200, z.array(ServiceVersionSchema))
  versions(@Param('id', new ParseUUIDPipe()) id: string): Promise<ServiceVersion[]> {
    return this.catalogue.listVersions(id);
  }

  @Post('services/:id/versions')
  @ApiOperation({
    summary: 'Start a new draft version',
    description:
      'Roles: ADMIN. Copies the latest version into a new draft; published versions are never edited in place.',
  })
  @ApiZodResponse(201, ServiceVersionSchema)
  @ApiResponse({ status: 409, description: 'DRAFT_EXISTS' })
  createDraft(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ReqCtx() ctx: RequestContext,
  ): Promise<ServiceVersion> {
    return this.catalogue.createDraft(user, id, ctx);
  }

  @Get('versions/:id')
  @ApiOperation({ summary: 'Get a version', description: 'Roles: ADMIN.' })
  @ApiZodResponse(200, ServiceVersionSchema)
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  version(@Param('id', new ParseUUIDPipe()) id: string): Promise<ServiceVersion> {
    return this.catalogue.getVersion(id);
  }

  @Patch('versions/:id')
  @ApiOperation({
    summary: 'Edit a draft version',
    description:
      'Roles: ADMIN. Drafts may hold incomplete definitions; they are fully checked on publish.',
  })
  @ApiZodBody(UpdateVersionRequestSchema, {
    fee: { baseCents: '1500', perCopyCents: '200' },
    feeIsTest: true,
  })
  @ApiZodResponse(200, ServiceVersionSchema)
  @ApiResponse(notEditable)
  updateDraft(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(UpdateVersionRequestSchema)) body: UpdateVersionRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<ServiceVersion> {
    return this.catalogue.updateDraft(user, id, body, ctx);
  }

  @Delete('versions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a draft version',
    description: 'Roles: ADMIN. Published and retired versions cannot be deleted.',
  })
  @ApiResponse({ status: 204, description: 'Draft deleted' })
  @ApiResponse(notEditable)
  async deleteDraft(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ReqCtx() ctx: RequestContext,
  ): Promise<void> {
    await this.catalogue.deleteDraft(user, id, ctx);
  }

  @Post('versions/:id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Publish a draft version',
    description:
      'Roles: ADMIN. Validates the form, documents and fee rule, then retires the previous published version in the same transaction.',
  })
  @ApiZodResponse(200, ServiceVersionSchema)
  @ApiResponse({ status: 422, description: 'VERSION_INVALID with the list of problems' })
  @ApiResponse(notEditable)
  publish(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ReqCtx() ctx: RequestContext,
  ): Promise<ServiceVersion> {
    return this.catalogue.publish(user, id, ctx);
  }

  @Post('versions/:id/retire')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retire the published version',
    description:
      'Roles: ADMIN. The service leaves the public catalogue until a new version is published.',
  })
  @ApiZodResponse(200, ServiceVersionSchema)
  @ApiResponse({ status: 409, description: 'VERSION_NOT_PUBLISHED' })
  retire(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ReqCtx() ctx: RequestContext,
  ): Promise<ServiceVersion> {
    return this.catalogue.retire(user, id, ctx);
  }
}
