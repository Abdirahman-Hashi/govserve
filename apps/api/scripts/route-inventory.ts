import { type INestApplicationContext, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { type Role } from '@govserve/shared';
import { API_PREFIX } from '../src/app.setup';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';

// Excluded from the global prefix in app.setup.ts (probes and the Prometheus scrape).
const UNPREFIXED = new Set(['/health', '/ready', '/metrics']);

export interface RouteInfo {
  /** e.g. "GET" */
  method: string;
  /** Full path with Express-style params, e.g. "/api/v1/applications/:id". */
  path: string;
  isPublic: boolean;
  roles: Role[];
}

/** Every route's @Public()/@Roles() decision, read straight from the compiled controllers. */
export function listRoutes(app: INestApplicationContext): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: never[]) => unknown) | null;
      if (!controller) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
      const classPublic = Reflect.getMetadata(IS_PUBLIC_KEY, controller) === true;
      const classRoles = Reflect.getMetadata(ROLES_KEY, controller) as Role[] | undefined;
      const proto = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const verb = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (verb === undefined) continue;
        const sub = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
        const raw = `/${[base, sub].filter((p) => p && p !== '/').join('/')}`.replace(/\/+/g, '/');
        routes.push({
          method: RequestMethod[verb],
          path: UNPREFIXED.has(raw) ? raw : `/${API_PREFIX}${raw}`,
          isPublic: Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true || classPublic,
          roles:
            (Reflect.getMetadata(ROLES_KEY, handler) as Role[] | undefined) ?? classRoles ?? [],
        });
      }
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}
