import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  type MyPaymentsQuery,
  MyPaymentsQuerySchema,
  type PaymentHistoryPage,
  PaymentHistoryPageSchema,
  type StaffApplicationResults,
  StaffApplicationResultsSchema,
  type StaffApplicationSearch,
  StaffApplicationSearchSchema,
  type StaffPaymentResults,
  StaffPaymentResultsSchema,
  type StaffPaymentSearch,
  StaffPaymentSearchSchema,
} from '@govserve/shared';
import { type Response } from 'express';
import { type AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ReqCtx, type RequestContext } from '../common/request-context';
import { ApiZodBody, ApiZodResponse, ZodPipe } from '../common/zod';
import { SearchService } from './search.service';

const badQuery = { status: 422, description: 'VALIDATION_FAILED' };
const badCursor = { status: 400, description: 'INVALID_CURSOR' };

/**
 * Staff searches are POST with a JSON body so national IDs, phones and names never appear in URLs
 * (proxy and access logs, Referer headers).
 */
@ApiTags('search')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
@Controller()
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('payments')
  @Roles('CITIZEN')
  @ApiOperation({
    summary: 'My payments and receipts',
    description:
      'Roles: CITIZEN (own only). Newest first, keyset pages of 25; q matches a reference or receipt number.',
  })
  @ApiZodResponse(200, PaymentHistoryPageSchema)
  @ApiResponse(badQuery)
  @ApiResponse(badCursor)
  myPayments(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(MyPaymentsQuerySchema)) q: MyPaymentsQuery,
  ): Promise<PaymentHistoryPage> {
    return this.search.myPayments(user, q);
  }

  @Post('search/applications')
  @HttpCode(HttpStatus.OK)
  @Roles('OFFICER', 'SUPERVISOR')
  @ApiOperation({
    summary: 'Search applications',
    description:
      'Roles: OFFICER, SUPERVISOR (own department only; drafts excluded). National ID and phone are matched through blind indexes.',
  })
  @ApiZodBody(StaffApplicationSearchSchema)
  @ApiZodResponse(200, StaffApplicationResultsSchema)
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse(badQuery)
  @ApiResponse(badCursor)
  applications(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(StaffApplicationSearchSchema)) q: StaffApplicationSearch,
  ): Promise<StaffApplicationResults> {
    return this.search.staffApplications(user, q);
  }

  @Post('search/payments')
  @HttpCode(HttpStatus.OK)
  @Roles('OFFICER', 'SUPERVISOR')
  @ApiOperation({
    summary: 'Search payments',
    description: 'Roles: OFFICER, SUPERVISOR (own department only).',
  })
  @ApiZodBody(StaffPaymentSearchSchema)
  @ApiZodResponse(200, StaffPaymentResultsSchema)
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse(badQuery)
  @ApiResponse(badCursor)
  payments(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(StaffPaymentSearchSchema)) q: StaffPaymentSearch,
  ): Promise<StaffPaymentResults> {
    return this.search.staffPayments(user, q);
  }

  @Post('search/applications.csv')
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(StaffApplicationSearchSchema)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary: 'Export application search as CSV',
    description:
      'Roles: SUPERVISOR (own department). Streamed, at most 50,000 rows, audited (SEARCH_EXPORTED).',
  })
  @ApiProduces('text/csv')
  @ApiResponse({ status: 200, description: 'CSV file' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse(badQuery)
  async exportApplications(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(StaffApplicationSearchSchema)) q: StaffApplicationSearch,
    @ReqCtx() ctx: RequestContext,
    @Res() res: Response,
  ): Promise<void> {
    await this.streamCsv(res, 'applications', (write) =>
      this.search.exportApplications(user, q, ctx, write),
    );
  }

  @Post('search/payments.csv')
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(StaffPaymentSearchSchema)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary: 'Export payment search as CSV',
    description:
      'Roles: SUPERVISOR (own department). Streamed, at most 50,000 rows, audited (SEARCH_EXPORTED).',
  })
  @ApiProduces('text/csv')
  @ApiResponse({ status: 200, description: 'CSV file' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse(badQuery)
  async exportPayments(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(StaffPaymentSearchSchema)) q: StaffPaymentSearch,
    @ReqCtx() ctx: RequestContext,
    @Res() res: Response,
  ): Promise<void> {
    await this.streamCsv(res, 'payments', (write) =>
      this.search.exportPayments(user, q, ctx, write),
    );
  }

  /** Headers are sent with the first chunk, so a refused export still returns a JSON error. */
  private async streamCsv(
    res: Response,
    kind: string,
    run: (write: (chunk: string) => Promise<void>) => Promise<number>,
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
            `attachment; filename="govserve-${kind}-${new Date().toISOString().slice(0, 10)}.csv"`,
          );
          res.setHeader('Cache-Control', 'private, no-store');
          res.write('\uFEFF'); // Excel reads UTF-8 with a BOM
        }
        // Respect backpressure on large exports.
        if (res.write(chunk)) resolve();
        else res.once('drain', () => resolve());
      });
    try {
      await run(write);
    } catch (err) {
      if (!started) throw err;
      res.destroy(err as Error);
      return;
    }
    res.end();
  }
}
