import { SetMetadata } from '@nestjs/common';
import { type Role } from '@govserve/shared';

export const ROLES_KEY = 'roles';

/** Declares which roles may call an endpoint. Enforced by the RolesGuard (Phase 02). */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
