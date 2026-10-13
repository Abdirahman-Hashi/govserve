import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  type CertificateSummary,
  CertificateSummarySchema,
  type NameCheckRequest,
  NameCheckRequestSchema,
  NameCheckResponseSchema,
  type OrderDuplicateRequest,
  OrderDuplicateRequestSchema,
  type PublicCertificate,
  PublicCertificateSchema,
  type RevokeCertificateRequest,
  RevokeCertificateRequestSchema,
} from '@govserve/shared';
import { Throttle } from '@nestjs/throttler';
import { type Response } from 'express';
import { z } from 'zod';
import { type AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ReqCtx, type RequestContext } from '../common/request-context';
import { ApiZodBody, ApiZodResponse, ZodPipe } from '../common/zod';
import { CertificatesService } from './certificates.service';

const uuid = new ParseUUIDPipe();
const certNo = new ZodPipe(z.string().regex(/^[A-Z]{2,5}-\d{4}-\d{6,}$/));

@ApiTags('certificates')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
@Controller()
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get('certificates')
  @Roles('CITIZEN')
  @ApiOperation({ summary: 'My certificates', description: 'Roles: CITIZEN (own only).' })
  @ApiZodResponse(200, z.array(CertificateSummarySchema))
  listMine(@CurrentUser() user: AuthUser): Promise<CertificateSummary[]> {
    return this.certificates.listMine(user);
  }

  @Get('certificates/:id/certificate.pdf')
  @Roles('CITIZEN', 'OFFICER', 'SUPERVISOR')
  @ApiOperation({
    summary: 'Download a certificate PDF',
    description: 'Roles: CITIZEN (own only), OFFICER/SUPERVISOR (own department). Audited.',
  })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'The signed certificate as a PDF' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  async pdf(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @ReqCtx() ctx: RequestContext,
    @Res() res: Response,
  ): Promise<void> {
    const { fileName, pdf } = await this.certificates.pdf(user, id, ctx);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }

  @Post('certificates/:id/duplicates')
  @Roles('CITIZEN')
  @ApiOperation({
    summary: 'Order a paid copy',
    description:
      'Roles: CITIZEN (own only). Creates a DUPLICATE application awaiting payment; the copy is issued once paid (A6).',
  })
  @ApiZodBody(OrderDuplicateRequestSchema)
  @ApiZodResponse(201, z.object({ applicationId: z.uuid() }))
  @ApiResponse({ status: 409, description: 'NOT_VALID' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  orderDuplicate(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(OrderDuplicateRequestSchema)) body: OrderDuplicateRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<{ applicationId: string }> {
    return this.certificates.orderDuplicate(user, id, body.copies, ctx);
  }

  @Post('certificates/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary: 'Revoke a certificate',
    description:
      'Roles: SUPERVISOR (own department). Reason FRAUD, ERROR or CHARGEBACK; copies are revoked too.',
  })
  @ApiZodBody(RevokeCertificateRequestSchema)
  @ApiZodResponse(200, CertificateSummarySchema)
  @ApiResponse({ status: 409, description: 'NOT_REVOCABLE' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(RevokeCertificateRequestSchema)) body: RevokeCertificateRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<CertificateSummary> {
    return this.certificates.revoke(user, id, body, ctx);
  }
}

@ApiTags('verify')
@Public()
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('verify')
export class CertificateVerifyController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get('c/:certificateNo')
  @ApiOperation({
    summary: 'Verify a certificate',
    description:
      'Public. Type, number, status, dates and a masked holder name. No other personal data.',
  })
  @ApiZodResponse(200, PublicCertificateSchema)
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  certificate(@Param('certificateNo', certNo) no: string): Promise<PublicCertificate> {
    return this.certificates.publicCertificate(no);
  }

  @Post('c/:certificateNo/name-check')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Check the holder’s name',
    description: 'Public, 10 per minute. Answers only whether the full name matches.',
  })
  @ApiZodBody(NameCheckRequestSchema)
  @ApiZodResponse(200, NameCheckResponseSchema)
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  nameCheck(
    @Param('certificateNo', certNo) no: string,
    @Body(new ZodPipe(NameCheckRequestSchema)) body: NameCheckRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<{ match: boolean }> {
    return this.certificates.nameCheck(no, body.name, ctx);
  }
}
