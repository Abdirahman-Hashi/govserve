import {
  Body,
  Controller,
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
  type InviteStaffRequest,
  InviteStaffRequestSchema,
  type StaffInvitationResponse,
  StaffInvitationResponseSchema,
  type StaffMember,
  StaffMemberSchema,
  type UpdateStaffRequest,
  UpdateStaffRequestSchema,
} from '@govserve/shared';
import { z } from 'zod';
import { type AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ReqCtx, type RequestContext } from '../common/request-context';
import { ApiZodBody, ApiZodResponse, ZodPipe } from '../common/zod';
import { StaffService } from './staff.service';

@ApiTags('staff')
@ApiBearerAuth()
@Roles('ADMIN')
@ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
@ApiResponse({ status: 403, description: 'FORBIDDEN (not an admin)' })
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @ApiOperation({ summary: 'List staff accounts', description: 'Roles: ADMIN.' })
  @ApiZodResponse(200, z.array(StaffMemberSchema))
  list(): Promise<StaffMember[]> {
    return this.staff.list();
  }

  @Post('invitations')
  @ApiOperation({
    summary: 'Invite a staff member',
    description:
      'Roles: ADMIN. Emails a one-time link valid for 72 hours. Officers and supervisors need a department; admins have none.',
  })
  @ApiZodBody(InviteStaffRequestSchema, {
    email: 'officer@bra.gov.so',
    fullName: 'Hodan Ali',
    role: 'OFFICER',
    departmentCode: 'POLICE',
  })
  @ApiZodResponse(201, StaffInvitationResponseSchema)
  @ApiResponse({ status: 409, description: 'EMAIL_IN_USE' })
  async invite(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(InviteStaffRequestSchema)) body: InviteStaffRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<StaffInvitationResponse> {
    return (await this.staff.invite({ id: user.id, role: user.role, type: 'USER' }, body, ctx))
      .invitation;
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Change a staff role or department',
    description: 'Roles: ADMIN. Signs the user out everywhere.',
  })
  @ApiZodBody(UpdateStaffRequestSchema, { role: 'SUPERVISOR', departmentCode: 'POLICE' })
  @ApiZodResponse(200, StaffMemberSchema)
  @ApiResponse({ status: 404, description: 'NOT_FOUND (not a staff account)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(UpdateStaffRequestSchema)) body: UpdateStaffRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<StaffMember> {
    return this.staff.update(user, id, body, ctx);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deactivate a staff account',
    description: 'Roles: ADMIN. Revokes all sessions and trusted devices immediately.',
  })
  @ApiZodResponse(200, StaffMemberSchema)
  @ApiResponse({ status: 404, description: 'NOT_FOUND (not a staff account)' })
  deactivate(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ReqCtx() ctx: RequestContext,
  ): Promise<StaffMember> {
    return this.staff.deactivate(user, id, ctx);
  }
}
