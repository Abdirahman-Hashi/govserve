import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { type AuthUser } from '../../auth/auth.types';

/** The authenticated caller (set by JwtAuthGuard). Only valid on non-public endpoints. */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<{ user: AuthUser }>().user,
);
