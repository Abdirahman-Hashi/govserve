import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApplicationLookupSchema,
  type ApplicationLookup,
  CardCheckoutSchema,
  type CardCheckout,
  CompleteRefundRequestSchema,
  type CompleteRefundRequest,
  DeclineRefundRequestSchema,
  type PaymentDto,
  PaymentSchema,
  RecordCashPaymentRequestSchema,
  type RecordCashPaymentRequest,
  type RefundDto,
  RefundSchema,
  RejectPaymentRequestSchema,
  type RejectPaymentRequest,
  RequestRefundRequestSchema,
  type RequestRefundRequest,
  type StaffPaymentDto,
  StaffPaymentSchema,
  SubmitManualPaymentRequestSchema,
  type SubmitManualPaymentRequest,
} from '@govserve/shared';
import { type Response } from 'express';
import { z } from 'zod';
import { type AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ReqCtx, type RequestContext } from '../common/request-context';
import { ApiZodBody, ApiZodResponse, ZodPipe } from '../common/zod';
import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';

const uuid = new ParseUUIDPipe();
const PaymentStatusQuery = z
  .enum([
    'INITIATED',
    'PENDING_VERIFICATION',
    'AWAITING_SUPERVISOR',
    'CONFIRMED',
    'REJECTED',
    'FAILED',
    'REVERSED',
  ])
  .optional();
const RefundStatusQuery = z
  .enum(['REQUESTED', 'APPROVED', 'DECLINED', 'COMPLETED', 'FAILED'])
  .optional();
const scoped = { status: 403, description: 'FORBIDDEN or OUT_OF_DEPARTMENT' };
const conflict = { status: 409, description: 'INVALID_TRANSITION or CONCURRENT_UPDATE' };

@ApiTags('payments')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('applications/:id/payments')
  @Roles('CITIZEN')
  @ApiOperation({
    summary: 'Report a mobile money or bank payment',
    description:
      'Roles: CITIZEN (own only). The payment waits for an officer to verify it (P1). Transaction/slip numbers can be used once.',
  })
  @ApiZodBody(SubmitManualPaymentRequestSchema, {
    channel: 'MOBILE_MONEY',
    provider: 'EVC_PLUS',
    reference: 'TX8839201',
    amountCents: '1900',
    paidAt: '2026-10-13',
  })
  @ApiZodResponse(201, PaymentSchema)
  @ApiResponse({ status: 409, description: 'DUPLICATE_REFERENCE or NOT_AWAITING_PAYMENT' })
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(SubmitManualPaymentRequestSchema)) body: SubmitManualPaymentRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<PaymentDto> {
    return this.payments.submitManual(user, id, body, ctx);
  }

  @Post('applications/:id/payments/card')
  @Roles('CITIZEN')
  @ApiOperation({
    summary: 'Start a card payment',
    description:
      'Roles: CITIZEN (own only). Returns the gateway checkout URL for the outstanding balance (P2). Repeat the same Idempotency-Key to get the same checkout.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: '8–64 letters, digits, - or _',
  })
  @ApiZodResponse(201, CardCheckoutSchema)
  @ApiResponse({ status: 400, description: 'IDEMPOTENCY_KEY_REQUIRED' })
  @ApiResponse({
    status: 409,
    description: 'NOTHING_TO_PAY, NOT_AWAITING_PAYMENT or IDEMPOTENCY_KEY_REUSED',
  })
  card(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @ReqCtx() ctx: RequestContext,
  ): Promise<CardCheckout> {
    return this.payments.startCard(user, id, key, ctx);
  }

  @Get('payments/:id/receipt.pdf')
  @Roles('CITIZEN', 'OFFICER', 'SUPERVISOR')
  @ApiOperation({
    summary: 'Download a receipt PDF',
    description: 'Roles: CITIZEN (own only), OFFICER/SUPERVISOR (own department).',
  })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'The signed receipt as a PDF' })
  @ApiResponse({ status: 409, description: 'NO_RECEIPT' })
  async receipt(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { fileName, pdf } = await this.payments.receiptPdf(user, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }

  @Get('staff/payments')
  @Roles('OFFICER', 'SUPERVISOR')
  @ApiOperation({
    summary: 'Payment verification queue',
    description:
      'Roles: OFFICER/SUPERVISOR (own department). Default: payments waiting for the caller (supervisors also see second confirmations).',
  })
  @ApiQuery({ name: 'status', required: false })
  @ApiZodResponse(200, z.array(StaffPaymentSchema))
  queue(
    @CurrentUser() user: AuthUser,
    @Query('status', new ZodPipe(PaymentStatusQuery)) status?: z.infer<typeof PaymentStatusQuery>,
  ): Promise<StaffPaymentDto[]> {
    return this.payments.staffList(user, status);
  }

  @Get('staff/payments/:id')
  @Roles('OFFICER', 'SUPERVISOR')
  @ApiOperation({
    summary: 'Payment details',
    description: 'Roles: OFFICER/SUPERVISOR (own department).',
  })
  @ApiZodResponse(200, StaffPaymentSchema)
  @ApiResponse(scoped)
  get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string): Promise<StaffPaymentDto> {
    return this.payments.staffGet(user, id);
  }

  @Post('staff/payments/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @Roles('OFFICER', 'SUPERVISOR')
  @ApiOperation({
    summary: 'Confirm a manual payment',
    description:
      'Roles: OFFICER/SUPERVISOR (own department). Above the threshold the first confirmation sends it to a supervisor (P6); the second must be a different supervisor (P8). Card payments are refused.',
  })
  @ApiZodResponse(200, StaffPaymentSchema)
  @ApiResponse({
    status: 403,
    description:
      'CARD_CONFIRMED_BY_GATEWAY, SECOND_PERSON_REQUIRED, NOT_PERMITTED or OUT_OF_DEPARTMENT',
  })
  @ApiResponse(conflict)
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @ReqCtx() ctx: RequestContext,
  ): Promise<StaffPaymentDto> {
    return this.payments.confirm(user, id, ctx);
  }

  @Post('staff/payments/:id/reject')
  @HttpCode(HttpStatus.OK)
  @Roles('OFFICER', 'SUPERVISOR')
  @ApiOperation({
    summary: 'Reject a manual payment',
    description:
      'Roles: OFFICER (pending only) / SUPERVISOR (own department). Reason code and note required (P7).',
  })
  @ApiZodBody(RejectPaymentRequestSchema, {
    reasonCode: 'REFERENCE_NOT_FOUND',
    note: 'No EVC Plus transaction with this ID on 13 Oct.',
  })
  @ApiZodResponse(200, StaffPaymentSchema)
  @ApiResponse(scoped)
  @ApiResponse(conflict)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(RejectPaymentRequestSchema)) body: RejectPaymentRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<StaffPaymentDto> {
    return this.payments.reject(user, id, body, ctx);
  }

  @Post('staff/payments/cash')
  @Roles('OFFICER', 'SUPERVISOR')
  @ApiOperation({
    summary: 'Record a cash payment at the counter',
    description:
      'Roles: OFFICER/SUPERVISOR (own department). Confirmed at once up to the threshold (P3), otherwise waits for a supervisor (P4).',
  })
  @ApiZodBody(RecordCashPaymentRequestSchema, {
    referenceNo: 'GS-2026-000123',
    amountCents: '1900',
    receiptBookRef: 'RB-0042-17',
    payerName: 'Amina Hassan',
  })
  @ApiZodResponse(201, StaffPaymentSchema)
  @ApiResponse({ status: 404, description: 'UNKNOWN_REFERENCE' })
  @ApiResponse({ status: 409, description: 'DUPLICATE_REFERENCE or NOT_AWAITING_PAYMENT' })
  @ApiResponse(scoped)
  cash(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(RecordCashPaymentRequestSchema)) body: RecordCashPaymentRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<StaffPaymentDto> {
    return this.payments.recordCash(user, body, ctx);
  }

  @Get('staff/applications/by-reference/:referenceNo')
  @Roles('OFFICER', 'SUPERVISOR')
  @ApiOperation({
    summary: 'Find an application by reference (cash desk)',
    description: 'Roles: OFFICER/SUPERVISOR (own department).',
  })
  @ApiZodResponse(200, ApplicationLookupSchema)
  @ApiResponse({ status: 404, description: 'UNKNOWN_REFERENCE' })
  @ApiResponse(scoped)
  lookup(
    @CurrentUser() user: AuthUser,
    @Param('referenceNo', new ZodPipe(z.string().regex(/^GS-\d{4}-\d{6,}$/))) referenceNo: string,
  ): Promise<ApplicationLookup> {
    return this.payments.lookup(user, referenceNo);
  }
}

@ApiTags('refunds')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
@Controller('staff')
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Post('payments/:id/refunds')
  @Roles('OFFICER', 'SUPERVISOR')
  @ApiOperation({
    summary: 'Request a refund',
    description:
      'Roles: OFFICER/SUPERVISOR (own department). Only for duplicates, overpayments, withdrawal before review or abandoned unpaid applications (R1).',
  })
  @ApiZodBody(RequestRefundRequestSchema, {
    reason: 'OVERPAYMENT',
    amountCents: '500',
    note: 'Paid $24 for a $19 fee.',
  })
  @ApiZodResponse(201, RefundSchema)
  @ApiResponse({ status: 422, description: 'REFUND_EXCEEDS_PAYMENT' })
  @ApiResponse({ status: 409, description: 'NOT_REFUNDABLE' })
  @ApiResponse(scoped)
  request(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(RequestRefundRequestSchema)) body: RequestRefundRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<RefundDto> {
    return this.refunds.request(user, id, body, ctx);
  }

  @Get('refunds')
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary: 'Refunds in my department',
    description: 'Roles: SUPERVISOR (own department).',
  })
  @ApiQuery({ name: 'status', required: false })
  @ApiZodResponse(200, z.array(RefundSchema))
  list(
    @CurrentUser() user: AuthUser,
    @Query('status', new ZodPipe(RefundStatusQuery)) status?: z.infer<typeof RefundStatusQuery>,
  ): Promise<RefundDto[]> {
    return this.refunds.list(user, status);
  }

  @Post('refunds/:id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary: 'Approve a refund',
    description: 'Roles: SUPERVISOR (own department). Card refunds are sent to the gateway (R2).',
  })
  @ApiZodResponse(200, RefundSchema)
  @ApiResponse(scoped)
  @ApiResponse(conflict)
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @ReqCtx() ctx: RequestContext,
  ): Promise<RefundDto> {
    return this.refunds.approve(user, id, ctx);
  }

  @Post('refunds/:id/decline')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary: 'Decline a refund',
    description: 'Roles: SUPERVISOR (own department). A note is required (R3).',
  })
  @ApiZodBody(DeclineRefundRequestSchema, { note: 'The application was already under review.' })
  @ApiZodResponse(200, RefundSchema)
  @ApiResponse(scoped)
  @ApiResponse(conflict)
  decline(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(DeclineRefundRequestSchema)) body: { note: string },
    @ReqCtx() ctx: RequestContext,
  ): Promise<RefundDto> {
    return this.refunds.decline(user, id, body.note, ctx);
  }

  @Post('refunds/:id/complete')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary: 'Record a manual refund payout',
    description: 'Roles: SUPERVISOR (own department). Not for card refunds (R4).',
  })
  @ApiZodBody(CompleteRefundRequestSchema, {
    payoutMethod: 'MOBILE_MONEY',
    payoutReference: 'EVC-RF-55120',
  })
  @ApiZodResponse(200, RefundSchema)
  @ApiResponse({
    status: 409,
    description: 'CARD_REFUND_BY_GATEWAY, INVALID_TRANSITION or CONCURRENT_UPDATE',
  })
  @ApiResponse(scoped)
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(CompleteRefundRequestSchema)) body: CompleteRefundRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<RefundDto> {
    return this.refunds.complete(user, id, body, ctx);
  }

  @Post('refunds/:id/retry')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary: 'Retry a failed card refund',
    description: 'Roles: SUPERVISOR (own department) (R6).',
  })
  @ApiZodResponse(200, RefundSchema)
  @ApiResponse(scoped)
  @ApiResponse(conflict)
  retry(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @ReqCtx() ctx: RequestContext,
  ): Promise<RefundDto> {
    return this.refunds.retry(user, id, ctx);
  }
}
