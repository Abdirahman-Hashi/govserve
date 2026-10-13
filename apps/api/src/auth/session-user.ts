import { type DepartmentCode, type SessionUser } from '@govserve/shared';
import { type Department, type User } from '../generated/prisma/client';
import { type TokenSubject } from './token.service';

export type UserWithDepartment = User & { department: Department | null };

export function toSessionUser(user: UserWithDepartment): SessionUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    departmentCode: (user.department?.code as DepartmentCode | undefined) ?? null,
    emailVerified: user.emailVerifiedAt !== null,
  };
}

export function toTokenSubject(user: UserWithDepartment): TokenSubject {
  return {
    id: user.id,
    role: user.role,
    departmentId: user.departmentId,
    departmentCode: (user.department?.code as DepartmentCode | undefined) ?? null,
  };
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? '';
}
