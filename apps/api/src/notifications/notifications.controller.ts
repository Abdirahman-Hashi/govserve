import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  type NotificationPage,
  NotificationPageSchema,
  type NotificationPreferences,
  NotificationPreferencesSchema,
  UnreadCountSchema,
} from '@govserve/shared';
import { z } from 'zod';
import { type AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ReqCtx, type RequestContext } from '../common/request-context';
import { ApiZodBody, ApiZodResponse, ZodPipe } from '../common/zod';
import { NotificationsService } from './notifications.service';

const ALL = ['CITIZEN', 'OFFICER', 'SUPERVISOR', 'ADMIN'] as const;

@ApiTags('notifications')
@ApiBearerAuth()
@Roles(...ALL)
@ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  @ApiOperation({
    summary: 'My notifications',
    description: 'Roles: any signed-in user (own only). Newest first, 20 per page.',
  })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiZodResponse(200, NotificationPageSchema)
  list(
    @CurrentUser() user: AuthUser,
    @Query('cursor', new ZodPipe(z.uuid().optional())) cursor?: string,
  ): Promise<NotificationPage> {
    return this.notifications.list(user.id, cursor);
  }

  @Get('notifications/unread-count')
  @ApiOperation({
    summary: 'Unread notification count',
    description: 'Roles: any signed-in user (own only).',
  })
  @ApiZodResponse(200, UnreadCountSchema)
  unread(@CurrentUser() user: AuthUser): Promise<{ unread: number }> {
    return this.notifications.unread(user.id);
  }

  @Post('notifications/read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Mark all notifications read',
    description: 'Roles: any signed-in user (own only).',
  })
  @ApiResponse({ status: 204, description: 'Done' })
  readAll(@CurrentUser() user: AuthUser): Promise<void> {
    return this.notifications.markAllRead(user.id);
  }

  @Post('notifications/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Mark a notification read',
    description: 'Roles: any signed-in user (own only).',
  })
  @ApiResponse({ status: 204, description: 'Done' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND (unknown, or someone else’s)' })
  read(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.notifications.markRead(user.id, id);
  }

  @Get('account/notification-preferences')
  @ApiOperation({
    summary: 'My email preferences',
    description: 'Roles: any signed-in user (own only).',
  })
  @ApiZodResponse(200, NotificationPreferencesSchema)
  preferences(@CurrentUser() user: AuthUser): Promise<NotificationPreferences> {
    return this.notifications.preferences(user.id);
  }

  @Put('account/notification-preferences')
  @ApiOperation({
    summary: 'Update my email preferences',
    description:
      'Roles: any signed-in user (own only). Only optional updates can be turned off; mandatory messages are always sent.',
  })
  @ApiZodBody(NotificationPreferencesSchema)
  @ApiZodResponse(200, NotificationPreferencesSchema)
  setPreferences(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(NotificationPreferencesSchema)) body: NotificationPreferences,
    @ReqCtx() ctx: RequestContext,
  ): Promise<NotificationPreferences> {
    return this.notifications.setPreferences(user, body, ctx);
  }
}
