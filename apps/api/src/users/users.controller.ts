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
  type ChangeEmailRequest,
  ChangeEmailRequestSchema,
  type ConfirmEmailChangeRequest,
  ConfirmEmailChangeRequestSchema,
  type Profile,
  ProfileSchema,
  type UpdateProfileRequest,
  UpdateProfileRequestSchema,
} from '@govserve/shared';
import { type AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ReqCtx, type RequestContext } from '../common/request-context';
import { ApiZodBody, ApiZodResponse, ZodPipe } from '../common/zod';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @Roles('CITIZEN', 'OFFICER', 'SUPERVISOR', 'ADMIN')
  @ApiOperation({
    summary: 'My profile',
    description: 'Roles: any signed-in user. The national ID is returned masked.',
  })
  @ApiZodResponse(200, ProfileSchema)
  me(@CurrentUser() user: AuthUser): Promise<Profile> {
    return this.users.profile(user, user.id);
  }

  @Patch('me')
  @Roles('CITIZEN', 'OFFICER', 'SUPERVISOR', 'ADMIN')
  @ApiOperation({
    summary: 'Update my profile',
    description:
      'Roles: any signed-in user. National ID, ID type and date of birth are citizen-only (403 otherwise); stored encrypted.',
  })
  @ApiZodBody(UpdateProfileRequestSchema, {
    phone: '+252 61 234 5678',
    nationalIdType: 'NATIONAL_ID',
    nationalId: 'SO1234567',
    dateOfBirth: '1990-04-12',
  })
  @ApiZodResponse(200, ProfileSchema)
  @ApiResponse({ status: 403, description: 'CITIZEN_ONLY_FIELDS' })
  @ApiResponse({ status: 409, description: 'NATIONAL_ID_IN_USE' })
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(UpdateProfileRequestSchema)) body: UpdateProfileRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<Profile> {
    return this.users.updateMe(user, body, ctx);
  }

  @Post('me/email')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles('CITIZEN', 'OFFICER', 'SUPERVISOR', 'ADMIN')
  @ApiOperation({
    summary: 'Start changing my email',
    description: 'Roles: any signed-in user. Emails a code to the new address.',
  })
  @ApiZodBody(ChangeEmailRequestSchema, { newEmail: 'amina.new@example.com' })
  @ApiResponse({ status: 202, description: 'Confirmation code sent to the new address' })
  @ApiResponse({ status: 409, description: 'EMAIL_IN_USE' })
  @ApiResponse({
    status: 429,
    description: 'RATE_LIMITED, or CODE_LIMIT: 5 codes were sent to this address today',
  })
  async changeEmail(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(ChangeEmailRequestSchema)) body: ChangeEmailRequest,
  ): Promise<void> {
    await this.users.requestEmailChange(user, body.newEmail);
  }

  @Post('me/email/confirm')
  @HttpCode(HttpStatus.OK)
  @Roles('CITIZEN', 'OFFICER', 'SUPERVISOR', 'ADMIN')
  @ApiOperation({
    summary: 'Confirm my new email with the code',
    description: 'Roles: any signed-in user.',
  })
  @ApiZodBody(ConfirmEmailChangeRequestSchema, { code: '123456' })
  @ApiZodResponse(200, ProfileSchema)
  confirmEmail(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(ConfirmEmailChangeRequestSchema)) body: ConfirmEmailChangeRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<Profile> {
    return this.users.confirmEmailChange(user, body.code, ctx);
  }

  @Get(':id')
  @Roles('CITIZEN', 'ADMIN')
  @ApiOperation({
    summary: 'Get a user profile',
    description:
      'Roles: ADMIN (any user), CITIZEN (only themselves; anyone else is 404 so IDs cannot be probed).',
  })
  @ApiZodResponse(200, ProfileSchema)
  @ApiResponse({ status: 403, description: 'FORBIDDEN (officer or supervisor)' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Profile> {
    return this.users.profile(user, id);
  }
}
