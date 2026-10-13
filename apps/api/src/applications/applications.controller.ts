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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  type ApplicationDetail,
  ApplicationDetailSchema,
  type ApplicationPage,
  ApplicationPageSchema,
  type MyApplicationsQuery,
  MyApplicationsQuerySchema,
  type CreateApplicationRequest,
  CreateApplicationRequestSchema,
  type UpdateApplicationRequest,
  UpdateApplicationRequestSchema,
} from '@govserve/shared';
import { type AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ReqCtx, type RequestContext } from '../common/request-context';
import { ApiZodBody, ApiZodResponse, ZodPipe } from '../common/zod';
import { SearchService } from '../search/search.service';
import { ApplicationsService } from './applications.service';

const uuid = new ParseUUIDPipe();
const notYours = { status: 404, description: 'NOT_FOUND (unknown, or another citizen’s)' };
const conflict = {
  status: 409,
  description: 'INVALID_TRANSITION, NOT_EDITABLE, FIELD_LOCKED or CONCURRENT_UPDATE',
};

@ApiTags('applications')
@ApiBearerAuth()
@Roles('CITIZEN')
@ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
@ApiResponse({ status: 403, description: 'FORBIDDEN (not a citizen)' })
@Controller()
export class ApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly search: SearchService,
  ) {}

  @Post('applications')
  @ApiOperation({
    summary: 'Start an application (draft)',
    description: 'Roles: CITIZEN. Pins the service’s current published version (A1).',
  })
  @ApiZodBody(CreateApplicationRequestSchema, { serviceCode: 'POLICE_CLEARANCE' })
  @ApiZodResponse(201, ApplicationDetailSchema)
  @ApiResponse({ status: 404, description: 'SERVICE_UNAVAILABLE' })
  @ApiResponse({ status: 409, description: 'OPEN_APPLICATION_EXISTS (details.applicationId)' })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(CreateApplicationRequestSchema)) body: CreateApplicationRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<ApplicationDetail> {
    return this.applications.create(user, body.serviceCode, ctx);
  }

  @Get('applications')
  @ApiOperation({
    summary: 'My applications',
    description:
      'Roles: CITIZEN (own only). Newest first, keyset pages of 25; filter by status, service, dates and part of the reference number.',
  })
  @ApiZodResponse(200, ApplicationPageSchema)
  @ApiResponse({ status: 422, description: 'VALIDATION_FAILED' })
  @ApiResponse({ status: 400, description: 'INVALID_CURSOR' })
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(MyApplicationsQuerySchema)) q: MyApplicationsQuery,
  ): Promise<ApplicationPage> {
    return this.search.myApplications(user, q);
  }

  @Get('applications/:id')
  @ApiOperation({
    summary: 'Application details',
    description:
      'Roles: CITIZEN (own only). Includes answers, documents, timeline and allowed actions.',
  })
  @ApiZodResponse(200, ApplicationDetailSchema)
  @ApiResponse(notYours)
  get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string): Promise<ApplicationDetail> {
    return this.applications.get(user, id);
  }

  @Patch('applications/:id')
  @ApiOperation({
    summary: 'Autosave answers or copies',
    description:
      'Roles: CITIZEN (own only). Drafts only, or during a correction only the flagged fields. A null value clears a field. Full validation happens on submit.',
  })
  @ApiZodBody(UpdateApplicationRequestSchema, {
    formData: { fullName: 'Amina Hassan', purpose: 'TRAVEL' },
    extraCopies: 1,
  })
  @ApiZodResponse(200, ApplicationDetailSchema)
  @ApiResponse(notYours)
  @ApiResponse(conflict)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(UpdateApplicationRequestSchema)) body: UpdateApplicationRequest,
  ): Promise<ApplicationDetail> {
    return this.applications.update(user, id, body);
  }

  @Delete('applications/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a draft',
    description: 'Roles: CITIZEN (own only). Drafts only; uploads are deleted too (A2).',
  })
  @ApiResponse({ status: 204, description: 'Draft deleted' })
  @ApiResponse(notYours)
  @ApiResponse(conflict)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @ReqCtx() ctx: RequestContext,
  ): Promise<void> {
    await this.applications.remove(user, id, ctx);
  }

  @Post('applications/:id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit an application',
    description:
      'Roles: CITIZEN (own only). Validates answers and documents, assigns the reference number and assesses the fee (A3).',
  })
  @ApiZodResponse(200, ApplicationDetailSchema)
  @ApiResponse({
    status: 422,
    description: 'VALIDATION_FAILED with formData.* and documents.* details',
  })
  @ApiResponse({
    status: 409,
    description: 'OPEN_APPLICATION_EXISTS, INVALID_TRANSITION or CONCURRENT_UPDATE',
  })
  @ApiResponse(notYours)
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @ReqCtx() ctx: RequestContext,
  ): Promise<ApplicationDetail> {
    return this.applications.submit(user, id, ctx);
  }

  @Post('applications/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Withdraw an application',
    description: 'Roles: CITIZEN (own only). Any time before a decision (A22).',
  })
  @ApiZodResponse(200, ApplicationDetailSchema)
  @ApiResponse(conflict)
  @ApiResponse(notYours)
  withdraw(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @ReqCtx() ctx: RequestContext,
  ): Promise<ApplicationDetail> {
    return this.applications.withdraw(user, id, ctx);
  }

  @Post('applications/:id/resubmit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resubmit after corrections',
    description:
      'Roles: CITIZEN (own only). Every flagged answer must change and every flagged document must be re-uploaded (A12).',
  })
  @ApiZodResponse(200, ApplicationDetailSchema)
  @ApiResponse({ status: 422, description: 'VALIDATION_FAILED: lists what still needs correcting' })
  @ApiResponse(conflict)
  @ApiResponse(notYours)
  resubmit(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @ReqCtx() ctx: RequestContext,
  ): Promise<ApplicationDetail> {
    return this.applications.resubmit(user, id, ctx);
  }
}
