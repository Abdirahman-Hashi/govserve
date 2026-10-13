import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  type AuditPage,
  AuditPageSchema,
  type AuditQuery,
  AuditQuerySchema,
  type AuditVerification,
  AuditVerificationSchema,
} from '@govserve/shared';
import { type Response } from 'express';
import { type AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ReqCtx, type RequestContext } from '../common/request-context';
import { ApiZodQuery, ApiZodResponse, ZodPipe } from '../common/zod';
import { AuditQueryService } from './audit-query.service';
import { AuditVerifierService } from './audit-verifier.service';

const scope =
  'Roles: SUPERVISOR (own department only; auth and admin rows are admin-only), ADMIN (all).';

@ApiTags('audit')
@ApiBearerAuth()
@Roles('SUPERVISOR', 'ADMIN')
@ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
@ApiResponse({ status: 403, description: 'FORBIDDEN' })
@Controller('audit')
export class AuditController {
  constructor(
    private readonly query: AuditQueryService,
    private readonly verifier: AuditVerifierService,
  ) {}

  @Get()
  @ApiZodQuery(AuditQuerySchema)
  @ApiOperation({
    summary: 'Audit trail',
    description: `${scope} Newest first, 50 per page; read-only.`,
  })
  @ApiZodResponse(200, AuditPageSchema)
  @ApiResponse({ status: 422, description: 'VALIDATION_FAILED' })
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(AuditQuerySchema)) q: AuditQuery,
  ): Promise<AuditPage> {
    return this.query.list(user, q);
  }

  @Get('applications/:id')
  @ApiOperation({
    summary: 'Full audit history of an application',
    description: `${scope} Includes its payments, refunds, documents and certificates, oldest first.`,
  })
  @ApiZodResponse(200, AuditPageSchema)
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  application(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AuditPage> {
    return this.query.applicationHistory(user, id);
  }

  @Get('export.csv')
  @ApiZodQuery(AuditQuerySchema)
  @ApiOperation({
    summary: 'Export the audit trail as CSV',
    description: `${scope} Streamed, at most 50,000 rows; audited (AUDIT_EXPORTED).`,
  })
  @ApiProduces('text/csv')
  @ApiResponse({ status: 200, description: 'CSV file' })
  @ApiResponse({ status: 422, description: 'VALIDATION_FAILED' })
  async exportCsv(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(AuditQuerySchema)) q: AuditQuery,
    @ReqCtx() ctx: RequestContext,
    @Res() res: Response,
  ): Promise<void> {
    let started = false;
    const write = (chunk: string) =>
      new Promise<void>((resolve) => {
        if (!started) {
          started = true;
          res.status(200);
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="govserve-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
          );
          res.setHeader('Cache-Control', 'private, no-store');
          res.write('\uFEFF'); // Excel reads UTF-8 with a BOM
        }
        if (res.write(chunk)) resolve();
        else res.once('drain', () => resolve());
      });
    try {
      await this.query.export(user, q, ctx, write);
    } catch (err) {
      if (!started) throw err;
      res.destroy(err as Error);
      return;
    }
    res.end();
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Verify the audit hash chain now',
    description:
      'Roles: ADMIN. Recomputes every hash and link; a break notifies all admins. Also runs nightly.',
  })
  @ApiZodResponse(200, AuditVerificationSchema)
  verify(): Promise<AuditVerification> {
    return this.verifier.verify();
  }
}
