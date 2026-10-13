import { type DepartmentCode, type Role } from '@govserve/shared';

/** The authenticated caller, attached to the request by JwtAuthGuard. */
export interface AuthUser {
  id: string;
  role: Role;
  departmentId: string | null;
  departmentCode: DepartmentCode | null;
  /** Refresh-token family of this session. */
  sid: string;
}

/** Claims in the access token. */
export interface AccessClaims {
  sub: string;
  role: Role;
  dept: string | null;
  deptCode: DepartmentCode | null;
  sid: string;
  iat?: number;
}
