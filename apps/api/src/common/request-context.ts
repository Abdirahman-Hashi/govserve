import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { type Request } from 'express';

/** Request metadata recorded on audit rows and refresh tokens. */
export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export function requestContextOf(req: Request & { id?: unknown }): RequestContext {
  return {
    ip: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
    requestId: typeof req.id === 'string' ? req.id : null,
  };
}

export const ReqCtx = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestContext =>
  requestContextOf(ctx.switchToHttp().getRequest()),
);
