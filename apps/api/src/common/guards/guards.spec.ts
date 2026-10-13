import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { type Role } from '@govserve/shared';
import { type AuthUser } from '../../auth/auth.types';
import { type SessionRevocationService } from '../../auth/session-revocation.service';
import { TokenService } from '../../auth/token.service';
import { Public } from '../decorators/public.decorator';
import { Roles } from '../decorators/roles.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { assertCitizenOwns, assertSameDepartment } from './scope';

class Fixture {
  @Public() open(this: void) {}
  @Roles('ADMIN') adminOnly(this: void) {}
  undecided(this: void) {}
}

function contextFor(handler: keyof Fixture, req: Record<string, unknown> = {}): ExecutionContext {
  const request = {
    get: (h: string) => (req['headers'] as Record<string, string> | undefined)?.[h],
    ...req,
  };
  return {
    getHandler: () => Fixture.prototype[handler],
    getClass: () => Fixture,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const reflector = new Reflector();
const tokens = new TokenService(new JwtService({ secret: 'x'.repeat(32) }));
const user = (role: Role, departmentId: string | null = null): AuthUser => ({
  id: 'u1',
  role,
  departmentId,
  departmentCode: null,
  sid: 's1',
});

describe('JwtAuthGuard', () => {
  const notRevoked = {
    isRevoked: () => Promise.resolve(false),
  } as unknown as SessionRevocationService;
  const guard = new JwtAuthGuard(reflector, tokens, notRevoked);

  it('should allow a @Public() endpoint without a token', async () => {
    await expect(guard.canActivate(contextFor('open'))).resolves.toBe(true);
  });

  it('should reject a protected endpoint when there is no token', async () => {
    await expect(guard.canActivate(contextFor('adminOnly'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('should reject a token signed with another secret', async () => {
    const forged = await new JwtService({ secret: 'y'.repeat(32) }).signAsync({
      sub: 'u',
      role: 'ADMIN',
    });
    const ctx = contextFor('adminOnly', { headers: { authorization: `Bearer ${forged}` } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should attach the user when the token is valid', async () => {
    const jwt = await tokens.signAccess(
      { id: 'u9', role: 'OFFICER', departmentId: 'd1', departmentCode: 'POLICE' },
      's9',
    );
    const req: Record<string, unknown> = { headers: { authorization: `Bearer ${jwt}` } };
    const ctx = contextFor('adminOnly', req);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const attached = ctx.switchToHttp().getRequest<{ user: AuthUser }>().user;
    expect(attached).toEqual({
      id: 'u9',
      role: 'OFFICER',
      departmentId: 'd1',
      departmentCode: 'POLICE',
      sid: 's9',
    });
  });

  it('should reject a token issued before the user sessions were revoked', async () => {
    const revoked = {
      isRevoked: () => Promise.resolve(true),
    } as unknown as SessionRevocationService;
    const jwt = await tokens.signAccess(
      { id: 'u9', role: 'ADMIN', departmentId: null, departmentCode: null },
      's9',
    );
    const ctx = contextFor('adminOnly', { headers: { authorization: `Bearer ${jwt}` } });
    await expect(
      new JwtAuthGuard(reflector, tokens, revoked).canActivate(ctx),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('RolesGuard', () => {
  const guard = new RolesGuard(reflector);

  it('should allow a listed role', () => {
    expect(guard.canActivate(contextFor('adminOnly', { user: user('ADMIN') }))).toBe(true);
  });

  it('should return 403 when the role is not listed', () => {
    expect(() => guard.canActivate(contextFor('adminOnly', { user: user('CITIZEN') }))).toThrow(
      ForbiddenException,
    );
  });

  it('should deny everyone when the endpoint has no @Roles() decision', () => {
    jest.spyOn(guard['logger'], 'error').mockImplementation(() => undefined);
    expect(() => guard.canActivate(contextFor('undecided', { user: user('ADMIN') }))).toThrow(
      ForbiddenException,
    );
  });
});

describe('scope helpers', () => {
  it('should return 404 when a citizen accesses another citizen record', () => {
    expect(() => assertCitizenOwns(user('CITIZEN'), 'someone-else')).toThrow(NotFoundException);
    expect(() => assertCitizenOwns(user('CITIZEN'), 'u1')).not.toThrow();
  });

  it('should return 403 when staff act outside their department', () => {
    expect(() => assertSameDepartment(user('OFFICER', 'police'), 'civil-registry')).toThrow(
      ForbiddenException,
    );
    expect(() => assertSameDepartment(user('SUPERVISOR', 'police'), 'police')).not.toThrow();
    expect(() => assertSameDepartment(user('ADMIN'), 'police')).toThrow(ForbiddenException);
  });
});
