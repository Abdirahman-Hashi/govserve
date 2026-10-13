import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request } from 'express';
import { type AuthUser } from '../../auth/auth.types';
import { SessionRevocationService } from '../../auth/session-revocation.service';
import { TokenService } from '../../auth/token.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Global guard 1/2: every non-@Public() endpoint needs a valid, unrevoked Bearer access token.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly revocation: SessionRevocationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublic(this.reflector, context)) return true;
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();

    const claims = await this.tokens.verifyAccess(token).catch(() => {
      throw new UnauthorizedException();
    });
    if (await this.revocation.isRevoked(claims.sub, claims.iat ?? 0))
      throw new UnauthorizedException();

    req.user = {
      id: claims.sub,
      role: claims.role,
      departmentId: claims.dept,
      departmentCode: claims.deptCode,
      sid: claims.sid,
    };
    return true;
  }
}

export function isPublic(reflector: Reflector, context: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) === true
  );
}
