import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ApplicationStatus,
  type CollectionsQuery,
  CollectionsQuerySchema,
  type CollectionsReport,
  CollectionsReportSchema,
  type MovementsPage,
  MovementsPageSchema,
  type MovementsQuery,
  MovementsQuerySchema,
  type PendingWorkReport,
  PendingWorkReportSchema,
  type ReportApplicationsPage,
  ReportApplicationsPageSchema,
  type ReportApplicationsQuery,
  ReportApplicationsQuerySchema,
  type ReportDataset,
  ReportDatasets,
  type ReportFilters,
  ReportFiltersSchema,
  type ReportSummary,
  ReportSummarySchema,
  type VolumesReport,
  VolumesReportSchema,
} from '@govserve/shared';
import { type Response } from 'express';
import { z } from 'zod';
import { type AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ReqCtx, type RequestContext } from '../common/request-context';
import { ApiZodQuery, ApiZodResponse, ZodPipe } from '../common/zod';
import { ReportsService } from './reports.service';

const scoped =
  'Roles: SUPERVISOR (own department only; departmentId is ignored), ADMIN (all departments, or one).';
const ExportQuerySchema = z
  .strictObject({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    departmentId: z.uuid().optional(),
    service: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{2,39}$/)
      .optional(),
    channel: z.enum(['MOBILE_MONEY', 'BANK', 'CASH', 'CARD']).optional(),
    kind: z.enum(['CONFIRMED', 'REFUNDED', 'REVERSED']).optional(),
    status: z
      .enum(Object.values(ApplicationStatus) as [ApplicationStatus, ...ApplicationStatus[]])
      .optional(),
    view: z.enum(['overdue', 'outstanding', 'decided', 'submitted']).optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'The start date must be on or before the end date',
    path: ['to'],
  });

@ApiTags('reports')
@ApiBearerAuth()
@Roles('SUPERVISOR', 'ADMIN')
@ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
@ApiResponse({ status: 403, description: 'FORBIDDEN (not a supervisor or admin)' })
@ApiResponse({ status: 422, description: 'VALIDATION_FAILED' })
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  @ApiZodQuery(ReportFiltersSchema)
  @ApiOperation({
    summary: 'Dashboard KPIs',
    description: `${scoped} Collections, outstanding, volumes, processing time, SLA.`,
  })
  @ApiZodResponse(200, ReportSummarySchema)
  summary(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(ReportFiltersSchema)) q: ReportFilters,
  ): Promise<ReportSummary> {
    return this.reports.summary(user, q);
  }

  @Get('collections')
  @ApiZodQuery(CollectionsQuerySchema)
  @ApiOperation({
    summary: 'Collections by day, service or channel',
    description: `${scoped} Confirmed minus refunds minus reversals, in cents.`,
  })
  @ApiZodResponse(200, CollectionsReportSchema)
  collections(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(CollectionsQuerySchema)) q: CollectionsQuery,
  ): Promise<CollectionsReport> {
    return this.reports.collections(user, q);
  }

  @Get('volumes')
  @ApiZodQuery(ReportFiltersSchema)
  @ApiOperation({ summary: 'Submitted vs completed per week', description: scoped })
  @ApiZodResponse(200, VolumesReportSchema)
  volumes(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(ReportFiltersSchema)) q: ReportFilters,
  ): Promise<VolumesReport> {
    return this.reports.volumes(user, q);
  }

  @Get('pending-work')
  @ApiZodQuery(ReportFiltersSchema)
  @ApiOperation({
    summary: 'Queue sizes and oldest items',
    description: `${scoped} A snapshot of now, per department and officer.`,
  })
  @ApiZodResponse(200, PendingWorkReportSchema)
  pendingWork(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(ReportFiltersSchema)) q: ReportFilters,
  ): Promise<PendingWorkReport> {
    return this.reports.pendingWork(user, q);
  }

  @Get('movements')
  @ApiZodQuery(MovementsQuerySchema)
  @ApiOperation({
    summary: 'Drill-down: money movements',
    description: `${scoped} Keyset pages of 25.`,
  })
  @ApiZodResponse(200, MovementsPageSchema)
  @ApiResponse({ status: 400, description: 'INVALID_CURSOR' })
  movements(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(MovementsQuerySchema)) q: MovementsQuery,
  ): Promise<MovementsPage> {
    return this.reports.movements(user, q);
  }

  @Get('applications')
  @ApiZodQuery(ReportApplicationsQuerySchema)
  @ApiOperation({
    summary: 'Drill-down: applications',
    description: `${scoped} Keyset pages of 25.`,
  })
  @ApiZodResponse(200, ReportApplicationsPageSchema)
  @ApiResponse({ status: 400, description: 'INVALID_CURSOR' })
  applications(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(ReportApplicationsQuerySchema)) q: ReportApplicationsQuery,
  ): Promise<ReportApplicationsPage> {
    return this.reports.applications(user, q);
  }

  @Get('export/:dataset.csv')
  @ApiZodQuery(ExportQuerySchema)
  @ApiOperation({
    summary: 'Export a report as CSV',
    description: `${scoped} Streamed; amounts in cents; audited (REPORT_EXPORTED).`,
  })
  @ApiProduces('text/csv')
  @ApiResponse({ status: 200, description: 'CSV file' })
  async exportCsv(
    @CurrentUser() user: AuthUser,
    @Param('dataset', new ZodPipe(z.enum(ReportDatasets))) dataset: ReportDataset,
    @Query(new ZodPipe(ExportQuerySchema)) q: z.infer<typeof ExportQuerySchema>,
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
            `attachment; filename="govserve-${dataset}-${new Date().toISOString().slice(0, 10)}.csv"`,
          );
          res.setHeader('Cache-Control', 'private, no-store');
          res.write('\uFEFF'); // Excel reads UTF-8 with a BOM
        }
        if (res.write(chunk)) resolve();
        else res.once('drain', () => resolve());
      });
    try {
      await this.reports.export(user, dataset, q, ctx, write);
    } catch (err) {
      if (!started) throw err;
      res.destroy(err as Error);
      return;
    }
    res.end();
  }
}
