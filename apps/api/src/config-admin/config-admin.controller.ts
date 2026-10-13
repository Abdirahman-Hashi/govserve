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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  type CreateHolidayRequest,
  CreateHolidayRequestSchema,
  type CreateReasonCodeRequest,
  CreateReasonCodeRequestSchema,
  type Holiday,
  HolidaySchema,
  type ReasonCode,
  ReasonCodeKinds,
  ReasonCodeSchema,
  type Setting,
  SettingSchema,
  UpdateReasonCodeRequestSchema,
  type UpdateReasonCodeRequest,
  UpdateSettingRequestSchema,
} from '@govserve/shared';
import { z } from 'zod';
import { type AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ReqCtx, type RequestContext } from '../common/request-context';
import { ApiZodBody, ApiZodResponse, ZodPipe } from '../common/zod';
import { ConfigAdminService } from './config-admin.service';

@ApiTags('admin: configuration')
@ApiBearerAuth()
@Roles('ADMIN')
@ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
@ApiResponse({ status: 403, description: 'FORBIDDEN (not an admin)' })
@Controller('admin')
export class ConfigAdminController {
  constructor(private readonly config: ConfigAdminService) {}

  @Get('settings')
  @ApiOperation({ summary: 'List system settings', description: 'Roles: ADMIN.' })
  @ApiZodResponse(200, z.array(SettingSchema))
  settings(): Promise<Setting[]> {
    return this.config.listSettings();
  }

  @Put('settings/:key')
  @ApiOperation({
    summary: 'Change a setting',
    description:
      'Roles: ADMIN. The value is validated against the schema for that key; audited with before/after.',
  })
  @ApiZodBody(UpdateSettingRequestSchema, { value: '10000' })
  @ApiZodResponse(200, SettingSchema)
  @ApiResponse({ status: 404, description: 'UNKNOWN_SETTING' })
  updateSetting(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body(new ZodPipe(UpdateSettingRequestSchema)) body: { value?: unknown },
    @ReqCtx() ctx: RequestContext,
  ): Promise<Setting> {
    return this.config.updateSetting(user, key, body.value, ctx);
  }

  @Get('holidays')
  @ApiOperation({
    summary: 'List public holidays',
    description: 'Roles: ADMIN. Used by working-day SLA calculations.',
  })
  @ApiZodResponse(200, z.array(HolidaySchema))
  holidays(): Promise<Holiday[]> {
    return this.config.listHolidays();
  }

  @Post('holidays')
  @ApiOperation({ summary: 'Add a public holiday', description: 'Roles: ADMIN.' })
  @ApiZodBody(CreateHolidayRequestSchema, { date: '2026-07-01', name: 'Independence Day' })
  @ApiZodResponse(201, HolidaySchema)
  @ApiResponse({ status: 409, description: 'HOLIDAY_EXISTS' })
  addHoliday(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(CreateHolidayRequestSchema)) body: CreateHolidayRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<Holiday> {
    return this.config.addHoliday(user, body, ctx);
  }

  @Delete('holidays/:date')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a public holiday', description: 'Roles: ADMIN.' })
  @ApiResponse({ status: 204, description: 'Holiday removed' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  async removeHoliday(
    @CurrentUser() user: AuthUser,
    @Param('date', new ZodPipe(z.iso.date())) date: string,
    @ReqCtx() ctx: RequestContext,
  ): Promise<void> {
    await this.config.removeHoliday(user, date, ctx);
  }

  @Get('reason-codes')
  @ApiOperation({
    summary: 'List reason codes',
    description: 'Roles: ADMIN. Optionally filtered by kind.',
  })
  @ApiQuery({ name: 'kind', required: false, enum: ReasonCodeKinds })
  @ApiZodResponse(200, z.array(ReasonCodeSchema))
  reasonCodes(
    @Query('kind', new ZodPipe(z.enum(ReasonCodeKinds).optional()))
    kind?: (typeof ReasonCodeKinds)[number],
  ): Promise<ReasonCode[]> {
    return this.config.listReasonCodes(kind);
  }

  @Post('reason-codes')
  @ApiOperation({
    summary: 'Add a reason code',
    description: 'Roles: ADMIN. Codes are never deleted; deactivate them instead.',
  })
  @ApiZodBody(CreateReasonCodeRequestSchema, {
    kind: 'REJECT',
    code: 'EXPIRED_DOCUMENT',
    label: 'Identity document has expired',
  })
  @ApiZodResponse(201, ReasonCodeSchema)
  @ApiResponse({ status: 409, description: 'REASON_CODE_EXISTS' })
  createReasonCode(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(CreateReasonCodeRequestSchema)) body: CreateReasonCodeRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<ReasonCode> {
    return this.config.createReasonCode(user, body, ctx);
  }

  @Patch('reason-codes/:id')
  @ApiOperation({ summary: 'Rename or deactivate a reason code', description: 'Roles: ADMIN.' })
  @ApiZodBody(UpdateReasonCodeRequestSchema, { active: false })
  @ApiZodResponse(200, ReasonCodeSchema)
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  updateReasonCode(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(UpdateReasonCodeRequestSchema)) body: UpdateReasonCodeRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<ReasonCode> {
    return this.config.updateReasonCode(user, id, body, ctx);
  }
}
