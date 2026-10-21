import { JwtService } from '@nestjs/jwt';
import { type RequestContext } from '../common/request-context';
import { type Prisma, type RefreshToken } from '../generated/prisma/client';
import { hashToken, TokenService } from './token.service';

function fakeDb() {
  const rows: RefreshToken[] = [];
  const matches = (r: RefreshToken, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v);
  const refreshToken = {
    create: ({ data }: { data: Partial<RefreshToken> }) => {
      const row = {
        id: `rt-${rows.length}`,
        rotatedAt: null,
        graceUsedAt: null,
        revokedAt: null,
        revokedReason: null,
        ...data,
      } as RefreshToken;
      rows.push(row);
      return Promise.resolve(row);
    },
    findUnique: ({ where }: { where: { tokenHash?: string; id?: string } }) =>
      Promise.resolve(
        rows.find((r) => r.tokenHash === where.tokenHash || r.id === where.id) ?? null,
      ),
    updateMany: ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Partial<RefreshToken>;
    }) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return Promise.resolve({ count: hit.length });
    },
  };
  return { db: { refreshToken } as unknown as Prisma.TransactionClient, rows };
}

const ctx: RequestContext = { ip: '127.0.0.1', userAgent: 'jest', requestId: 'req-1' };
const service = new TokenService(new JwtService({ secret: 'x'.repeat(32) }));

describe('TokenService', () => {
  it('should store only the SHA-256 hash of a refresh token', async () => {
    const { db, rows } = fakeDb();
    const { token } = await service.issueRefresh(db, 'user-1', ctx);
    expect(rows[0]!.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('should rotate within the same family when the token is current', async () => {
    const { db, rows } = fakeDb();
    const first = await service.issueRefresh(db, 'user-1', ctx);
    const result = await service.rotate(db, first.token, ctx);
    expect(result.status).toBe('OK');
    if (result.status !== 'OK') return;
    expect(result.refresh.familyId).toBe(first.familyId);
    expect(result.refresh.token).not.toBe(first.token);
    expect(rows[0]!.rotatedAt).not.toBeNull();
  });

  it('should revoke the whole family when a rotated token is reused after the grace period', async () => {
    const { db, rows } = fakeDb();
    const t0 = new Date();
    const first = await service.issueRefresh(db, 'user-1', ctx, undefined, t0);
    const second = await service.rotate(db, first.token, ctx, t0);
    expect(second.status).toBe('OK');

    const replay = await service.rotate(db, first.token, ctx, new Date(t0.getTime() + 11_000));
    expect(replay).toEqual({ status: 'REUSED', userId: 'user-1', familyId: first.familyId });
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    expect(rows.map((r) => r.revokedReason)).toEqual(['REUSE_DETECTED', 'REUSE_DETECTED']);

    // The thief's newer token is now dead too.
    if (second.status === 'OK') {
      expect((await service.rotate(db, second.refresh.token, ctx)).status).toBe('REUSED');
    }
  });

  it('should continue the session when a just-rotated token comes again within the grace period', async () => {
    const { db, rows } = fakeDb();
    const t0 = new Date();
    const first = await service.issueRefresh(db, 'user-1', ctx, undefined, t0);
    await service.rotate(db, first.token, ctx, t0);
    const again = await service.rotate(db, first.token, ctx, new Date(t0.getTime() + 5_000));
    expect(again.status).toBe('OK');
    if (again.status === 'OK') expect(again.refresh.familyId).toBe(first.familyId);
    expect(rows.every((r) => r.revokedAt === null)).toBe(true);
  });

  it('should revoke the whole family when a just-rotated token comes a third time within the grace period', async () => {
    const { db, rows } = fakeDb();
    const t0 = new Date();
    const first = await service.issueRefresh(db, 'user-1', ctx, undefined, t0);
    await service.rotate(db, first.token, ctx, t0);
    const tab2 = await service.rotate(db, first.token, ctx, new Date(t0.getTime() + 2_000));
    expect(tab2.status).toBe('OK');
    const thief = await service.rotate(db, first.token, ctx, new Date(t0.getTime() + 4_000));
    expect(thief).toEqual({ status: 'REUSED', userId: 'user-1', familyId: first.familyId });
    expect(rows.every((r) => r.revokedReason === 'REUSE_DETECTED')).toBe(true);
  });

  it('should reject an unknown or expired token', async () => {
    const { db } = fakeDb();
    expect((await service.rotate(db, 'nope', ctx)).status).toBe('INVALID');
    const issuedAt = new Date('2026-01-01T00:00:00Z');
    const { token } = await service.issueRefresh(db, 'user-1', ctx, undefined, issuedAt);
    expect((await service.rotate(db, token, ctx, new Date('2026-02-01T00:00:00Z'))).status).toBe(
      'INVALID',
    );
  });

  it('should leave other families alone when one family is revoked', async () => {
    const { db, rows } = fakeDb();
    const a = await service.issueRefresh(db, 'user-1', ctx);
    await service.issueRefresh(db, 'user-1', ctx);
    await service.revokeByToken(db, a.token, 'LOGOUT');
    expect(rows.map((r) => r.revokedReason)).toEqual(['LOGOUT', null]);
  });

  it('should sign access tokens that verify with the session ID', async () => {
    const jwt = await service.signAccess(
      { id: 'u', role: 'CITIZEN', departmentId: null, departmentCode: null },
      'fam',
    );
    await expect(service.verifyAccess(jwt)).resolves.toMatchObject({
      sub: 'u',
      role: 'CITIZEN',
      sid: 'fam',
    });
  });
});
