import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Role } from '@govserve/shared';
import { type AuthUser } from '../../auth/auth.types';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { isPublic } from './jwt-auth.guard';

/**
 * Global guard 2/2: deny by default (.claude/rules/security.md). A non-public endpoint
 * without @Roles() is a bug and is refused for everyone; otherwise the caller's role must be listed.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (isPublic(this.reflector, context)) return true;
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) {
      this.logger.error(
        { handler: `${context.getClass().name}.${context.getHandler().name}` },
        'Endpoint has no @Roles() or @Public() decision; denying',
      );
      throw new ForbiddenException();
    }
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || !roles.includes(user.role)) throw new ForbiddenException();
    return true;
  }
}
