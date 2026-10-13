import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  type AssignRequest,
  AssignRequestSchema,
  type QueueItem,
  QueueItemSchema,
  type QueueQuery,
  QueueQuerySchema,
  type RecordAppointmentRequest,
  RecordAppointmentRequestSchema,
  type ReferRequest,
  ReferRequestSchema,
  type RejectApplicationRequest,
  RejectApplicationRequestSchema,
  type RequestCorrectionRequest,
  RequestCorrectionRequestSchema,
  type ResolveChargebackRequest,
  ResolveChargebackRequestSchema,
  type ReturnRequest,
  ReturnRequestSchema,
  type ScheduleAppointmentRequest,
  ScheduleAppointmentRequestSchema,
  type StaffApplication,
  StaffApplicationSchema,
  UnmaskedSchema,
  type VersionOnly,
  VersionOnlySchema,
} from '@govserve/shared';
import { z } from 'zod';
import { type AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ReqCtx, type RequestContext } from '../common/request-context';
import { ApiZodBody, ApiZodResponse, ZodPipe } from '../common/zod';
import { ReviewService } from './review.service';

const uuid = new ParseUUIDPipe();
const conflict = {
  status: 409,
  description: 'INVALID_TRANSITION, CONCURRENT_UPDATE, APPROVAL_BLOCKED or a rule-specific code',
};
const notFound = { status: 404, description: 'NOT_FOUND' };

@ApiTags('review')
@ApiBearerAuth()
@Roles('OFFICER', 'SUPERVISOR')
@ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
@ApiResponse({
  status: 403,
  description: 'FORBIDDEN (not staff, or another department’s application)',
})
@Controller('review')
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get('queue')
  @ApiOperation({
    summary: 'Department work queue',
    description: 'Roles: OFFICER, SUPERVISOR (own department). Ordered by SLA due date (FR-070).',
  })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'service', required: false })
  @ApiQuery({ name: 'assignee', required: false, description: 'me, unassigned or a user id' })
  @ApiQuery({ name: 'risk', required: false })
  @ApiZodResponse(200, z.array(QueueItemSchema))
  queue(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(QueueQuerySchema)) q: QueueQuery,
  ): Promise<QueueItem[]> {
    return this.review.queue(user, q);
  }

  @Post('claim-next')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Claim the most urgent application',
    description: 'Roles: OFFICER, SUPERVISOR. A8 on the oldest-due QUEUED application.',
  })
  @ApiZodResponse(200, StaffApplicationSchema)
  @ApiResponse({ status: 404, description: 'QUEUE_EMPTY' })
  claimNext(
    @CurrentUser() user: AuthUser,
    @ReqCtx() ctx: RequestContext,
  ): Promise<StaffApplication> {
    return this.review.claimNext(user, ctx);
  }

  @Get('applications/:id')
  @ApiOperation({
    summary: 'Application for review',
    description: 'Roles: OFFICER, SUPERVISOR (own department). Personal fields are masked.',
  })
  @ApiZodResponse(200, StaffApplicationSchema)
  @ApiResponse(notFound)
  detail(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string): Promise<StaffApplication> {
    return this.review.detail(user, id);
  }

  @Post('applications/:id/unmask')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Show personal fields',
    description: 'Roles: OFFICER, SUPERVISOR (own department). Audited as APPLICATION_PII_VIEWED.',
  })
  @ApiZodResponse(200, UnmaskedSchema)
  @ApiResponse(notFound)
  unmask(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @ReqCtx() ctx: RequestContext,
  ) {
    return this.review.unmask(user, id, ctx);
  }

  @Post('applications/:id/claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Claim an application',
    description: 'Roles: OFFICER, SUPERVISOR (own department). A8.',
  })
  @ApiZodBody(VersionOnlySchema)
  @ApiZodResponse(200, StaffApplicationSchema)
  @ApiResponse(conflict)
  @ApiResponse(notFound)
  claim(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(VersionOnlySchema)) body: VersionOnly,
    @ReqCtx() ctx: RequestContext,
  ): Promise<StaffApplication> {
    return this.review.claim(user, id, body.version, ctx);
  }

  @Post('applications/:id/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Release a claim',
    description: 'Roles: OFFICER (assignee), SUPERVISOR. A9.',
  })
  @ApiZodBody(VersionOnlySchema)
  @ApiZodResponse(200, StaffApplicationSchema)
  @ApiResponse(conflict)
  @ApiResponse(notFound)
  release(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(VersionOnlySchema)) body: VersionOnly,
    @ReqCtx() ctx: RequestContext,
  ): Promise<StaffApplication> {
    return this.review.release(user, id, body.version, ctx);
  }

  @Post('applications/:id/assign')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary: 'Assign or reassign',
    description: 'Roles: SUPERVISOR (own department). A10.',
  })
  @ApiZodBody(AssignRequestSchema)
  @ApiZodResponse(200, StaffApplicationSchema)
  @ApiResponse({ status: 422, description: 'INVALID_ASSIGNEE' })
  @ApiResponse(conflict)
  @ApiResponse(notFound)
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(AssignRequestSchema)) body: AssignRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<StaffApplication> {
    return this.review.assign(user, id, body.version, body.officerId, ctx);
  }

  @Post('applications/:id/corrections')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request corrections',
    description: 'Roles: OFFICER/SUPERVISOR (assignee). A11; at most 3 rounds; 30-day deadline.',
  })
  @ApiZodBody(RequestCorrectionRequestSchema)
  @ApiZodResponse(200, StaffApplicationSchema)
  @ApiResponse({
    status: 409,
    description: 'MAX_CORRECTION_ROUNDS, INVALID_TRANSITION or CONCURRENT_UPDATE',
  })
  @ApiResponse(notFound)
  requestCorrection(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(RequestCorrectionRequestSchema)) body: RequestCorrectionRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<StaffApplication> {
    return this.review.requestCorrection(user, id, body, ctx);
  }

  @Post('applications/:id/appointment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Schedule the in-person step',
    description: 'Roles: OFFICER/SUPERVISOR (assignee). A14.',
  })
  @ApiZodBody(ScheduleAppointmentRequestSchema)
  @ApiZodResponse(200, StaffApplicationSchema)
  @ApiResponse({
    status: 409,
    description: 'NO_IN_PERSON_STEP, MAX_RESCHEDULES, INVALID_TRANSITION or CONCURRENT_UPDATE',
  })
  @ApiResponse(notFound)
  schedule(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(ScheduleAppointmentRequestSchema)) body: ScheduleAppointmentRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<StaffApplication> {
    return this.review.scheduleAppointment(user, id, body, ctx);
  }

  @Post('applications/:id/appointment/outcome')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record attendance',
    description: 'Roles: OFFICER/SUPERVISOR (assignee). A15.',
  })
  @ApiZodBody(RecordAppointmentRequestSchema)
  @ApiZodResponse(200, StaffApplicationSchema)
  @ApiResponse({
    status: 409,
    description: 'NO_APPOINTMENT, APPOINTMENT_NOT_YET, INVALID_TRANSITION or CONCURRENT_UPDATE',
  })
  @ApiResponse(notFound)
  recordAppointment(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(RecordAppointmentRequestSchema)) body: RecordAppointmentRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<StaffApplication> {
    return this.review.recordAppointment(user, id, body, ctx);
  }

  @Post('applications/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve',
    description:
      'Roles: OFFICER/SUPERVISOR (assignee). Issues the certificate (A16), or forwards birth certificates for a second approval (A17).',
  })
  @ApiZodBody(VersionOnlySchema)
  @ApiZodResponse(200, StaffApplicationSchema)
  @ApiResponse(conflict)
  @ApiResponse(notFound)
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(VersionOnlySchema)) body: VersionOnly,
    @ReqCtx() ctx: RequestContext,
  ): Promise<StaffApplication> {
    return this.review.approve(user, id, body.version, ctx);
  }

  @Post('applications/:id/refer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record found (police)',
    description:
      'Roles: OFFICER/SUPERVISOR (assignee). A17; the note is encrypted and never shown to the citizen.',
  })
  @ApiZodBody(ReferRequestSchema)
  @ApiZodResponse(200, StaffApplicationSchema)
  @ApiResponse({
    status: 409,
    description: 'NOT_REFERRABLE, APPOINTMENT_REQUIRED, INVALID_TRANSITION or CONCURRENT_UPDATE',
  })
  @ApiResponse(notFound)
  refer(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(ReferRequestSchema)) body: ReferRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<StaffApplication> {
    return this.review.refer(user, id, body.version, body.note, ctx);
  }

  @Post('applications/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject',
    description:
      'Roles: OFFICER/SUPERVISOR (assignee), SUPERVISOR (second level). A21 with a reason code.',
  })
  @ApiZodBody(RejectApplicationRequestSchema)
  @ApiZodResponse(200, StaffApplicationSchema)
  @ApiResponse(conflict)
  @ApiResponse(notFound)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(RejectApplicationRequestSchema)) body: RejectApplicationRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<StaffApplication> {
    return this.review.reject(user, id, body.version, body.reasonCode, body.note, ctx);
  }

  @Post('applications/:id/second-approve')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary: 'Second approval',
    description:
      'Roles: SUPERVISOR, not the officer who forwarded it. A18; issues the certificate.',
  })
  @ApiZodBody(VersionOnlySchema)
  @ApiZodResponse(200, StaffApplicationSchema)
  @ApiResponse({ status: 403, description: 'SECOND_PERSON_REQUIRED' })
  @ApiResponse(conflict)
  @ApiResponse(notFound)
  secondApprove(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(VersionOnlySchema)) body: VersionOnly,
    @ReqCtx() ctx: RequestContext,
  ): Promise<StaffApplication> {
    return this.review.secondApprove(user, id, body.version, ctx);
  }

  @Post('applications/:id/confirm-referral')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary: 'Confirm a referral (police record found)',
    description: 'Roles: SUPERVISOR, not the referring officer. A19; no certificate.',
  })
  @ApiZodBody(VersionOnlySchema)
  @ApiZodResponse(200, StaffApplicationSchema)
  @ApiResponse({ status: 403, description: 'SECOND_PERSON_REQUIRED' })
  @ApiResponse(conflict)
  @ApiResponse(notFound)
  confirmReferral(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(VersionOnlySchema)) body: VersionOnly,
    @ReqCtx() ctx: RequestContext,
  ): Promise<StaffApplication> {
    return this.review.confirmReferral(user, id, body.version, ctx);
  }

  @Post('applications/:id/return')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary: 'Return to the officer',
    description: 'Roles: SUPERVISOR. A20 with a note.',
  })
  @ApiZodBody(ReturnRequestSchema)
  @ApiZodResponse(200, StaffApplicationSchema)
  @ApiResponse(conflict)
  @ApiResponse(notFound)
  returnToOfficer(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(ReturnRequestSchema)) body: ReturnRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<StaffApplication> {
    return this.review.returnToOfficer(user, id, body.version, body.note, ctx);
  }

  @Post('applications/:id/chargeback')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary: 'Resolve a chargeback',
    description:
      'Roles: SUPERVISOR (own department). Keep the certificate or revoke it (reason CHARGEBACK).',
  })
  @ApiZodBody(ResolveChargebackRequestSchema)
  @ApiZodResponse(200, StaffApplicationSchema)
  @ApiResponse({ status: 409, description: 'NO_CHARGEBACK or CONCURRENT_UPDATE' })
  @ApiResponse(notFound)
  resolveChargeback(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(ResolveChargebackRequestSchema)) body: ResolveChargebackRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<StaffApplication> {
    return this.review.resolveChargeback(user, id, body, ctx);
  }
}
