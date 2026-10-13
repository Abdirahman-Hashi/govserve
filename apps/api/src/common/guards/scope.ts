import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { type AuthUser } from '../../auth/auth.types';

/**
 * Citizen ownership (FR-012): another citizen's record is reported as not found, so record
 * IDs cannot be probed. Staff access is decided by the endpoint's roles and department scope.
 */
export function assertCitizenOwns(user: AuthUser, ownerId: string): void {
  if (user.role === 'CITIZEN' && user.id !== ownerId) throw new NotFoundException();
}

/**
 * Department scope (FR-013): officers and supervisors only act on their own department's
 * records; admins have no department and are not allowed through here.
 */
export function assertSameDepartment(user: AuthUser, recordDepartmentId: string | null): void {
  if (user.role !== 'OFFICER' && user.role !== 'SUPERVISOR') throw new ForbiddenException();
  if (!user.departmentId || user.departmentId !== recordDepartmentId)
    throw new ForbiddenException();
}
