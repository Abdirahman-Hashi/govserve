import { type AuthSession, type LoginResponse } from '@govserve/shared';
import request from 'supertest';
import { type ErrorEnvelope } from '../../src/common/filters/error-envelope.filter';
import { PurgeService } from '../../src/jobs/purge.service';
import {
  bearer,
  codeFrom,
  CookieJar,
  type Harness,
  PASSWORD,
  send,
  signUpCitizen,
  signUpStaff,
  startHarness,
  uniqueEmail,
} from './harness';

const api = '/api/v1';

describe('Authentication (integration)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });

  afterAll(async () => {
    await h?.close();
  });

  const actions = async (entityId: string) =>
    (await h.prisma.auditLog.findMany({ where: { entityId }, orderBy: { id: 'asc' } })).map(
      (a) => a.action,
    );

  describe('citizen register → verify → refresh → logout', () => {
    it('should complete the full flow and audit every step', async () => {
      const { session, jar } = await signUpCitizen(h);
      expect(session.user).toMatchObject({
        role: 'CITIZEN',
        emailVerified: true,
        departmentCode: null,
      });

      const firstRefresh = jar.get('gs_refresh');
      expect(firstRefresh).toBeDefined();
      const refreshed = await send(jar, request(h.http()).post(`${api}/auth/refresh`));
      expect(refreshed.status).toBe(200);
      expect(jar.get('gs_refresh')).not.toBe(firstRefresh);

      const me = await request(h.http())
        .get(`${api}/users/me`)
        .set(bearer(refreshed.body as AuthSession))
        .expect(200);
      expect(me.body).toMatchObject({ email: session.user.email, phone: '+252 61 234 5678' });

      const beforeLogout = jar.get('gs_refresh')!;
      await send(jar, request(h.http()).post(`${api}/auth/logout`)).then((r) =>
        expect(r.status).toBe(204),
      );
      expect(jar.get('gs_refresh')).toBeUndefined();
      // The token that was current at logout no longer works.
      const after = await request(h.http())
        .post(`${api}/auth/refresh`)
        .set('Cookie', `gs_refresh=${beforeLogout}`);
      expect(after.status).toBe(401);
      const revoked = await h.prisma.refreshToken.findMany({ where: { userId: session.user.id } });
      expect(revoked.every((t) => t.revokedAt !== null)).toBe(true);
      expect(revoked.find((t) => t.rotatedAt === null)?.revokedReason).toBe('LOGOUT');

      expect(await actions(session.user.id)).toEqual(
        expect.arrayContaining([
          'USER_REGISTERED',
          'USER_EMAIL_VERIFIED',
          'AUTH_LOGIN',
          'AUTH_LOGOUT',
        ]),
      );
    });

    it('should store phone encrypted and never in plaintext', async () => {
      const { session } = await signUpCitizen(h);
      const row = await h.prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });
      expect(Buffer.from(row.phoneEnc!).toString('utf8')).not.toContain('234 5678');
      expect(row.phoneBidx).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('should answer 202 and send nothing when the email is already registered', async () => {
      const { email } = await signUpCitizen(h);
      const before = h.mail.sent.length;
      await request(h.http())
        .post(`${api}/auth/register`)
        .send({ fullName: 'Someone Else', email, phone: '+252 61 000 0000', password: PASSWORD })
        .expect(202);
      expect(h.mail.sent.length).toBe(before);
    });

    it('should answer 202 to every request and create one account when the same email registers concurrently', async () => {
      const email = uniqueEmail('race');
      const attempts = await Promise.all(
        [1, 2, 3, 4].map(() =>
          request(h.http()).post(`${api}/auth/register`).send({
            fullName: 'Amina Hassan',
            email,
            phone: '+252 61 234 5678',
            password: PASSWORD,
          }),
        ),
      );
      expect(attempts.map((r) => r.status)).toEqual([202, 202, 202, 202]);
      expect(await h.prisma.user.count({ where: { email } })).toBe(1);
    });

    it('should refuse login with 403 EMAIL_NOT_VERIFIED before verification', async () => {
      const email = uniqueEmail('unverified');
      await request(h.http())
        .post(`${api}/auth/register`)
        .send({ fullName: 'Not Verified', email, phone: '+252 61 111 1111', password: PASSWORD })
        .expect(202);
      const res = await request(h.http())
        .post(`${api}/auth/login`)
        .send({ email, password: PASSWORD });
      expect(res.status).toBe(403);
      expect((res.body as ErrorEnvelope).error.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('should reject a common password with 422 WEAK_PASSWORD', async () => {
      const res = await request(h.http())
        .post(`${api}/auth/register`)
        .send({
          fullName: 'Weak Pass',
          email: uniqueEmail('weak'),
          phone: '+252 61 111 1111',
          password: '1234567890',
        });
      expect(res.status).toBe(422);
      expect((res.body as ErrorEnvelope).error.code).toBe('WEAK_PASSWORD');
    });
  });

  describe('refresh-token reuse detection', () => {
    it('should revoke the whole family and existing access tokens when a rotated token is replayed', async () => {
      const { session, jar } = await signUpCitizen(h);
      const stolen = jar.get('gs_refresh')!;
      const rotated = await send(jar, request(h.http()).post(`${api}/auth/refresh`));
      expect(rotated.status).toBe(200);
      const current = jar.get('gs_refresh')!;

      const replay = await request(h.http())
        .post(`${api}/auth/refresh`)
        .set('Cookie', `gs_refresh=${stolen}`);
      expect(replay.status).toBe(401);

      // The legitimate newer token is dead too, and so is the access token issued before.
      await request(h.http())
        .post(`${api}/auth/refresh`)
        .set('Cookie', `gs_refresh=${current}`)
        .expect(401);
      await request(h.http())
        .get(`${api}/users/me`)
        .set(bearer(rotated.body as AuthSession))
        .expect(401);
      expect(await actions(session.user.id)).toContain('AUTH_REFRESH_REUSE');
    });

    it('should reject refresh with 403 when the Origin is not the web app', async () => {
      const { jar } = await signUpCitizen(h);
      const res = await request(h.http())
        .post(`${api}/auth/refresh`)
        .set('Cookie', jar.header())
        .set('Origin', 'https://evil.example');
      expect(res.status).toBe(403);
      expect((res.body as ErrorEnvelope).error.code).toBe('BAD_ORIGIN');
    });
  });

  describe('lockout (FR-004)', () => {
    it('should lock after 5 failures and answer like an unknown account', async () => {
      const { email, session } = await signUpCitizen(h);
      for (let i = 0; i < 5; i++) {
        await request(h.http())
          .post(`${api}/auth/login`)
          .send({ email, password: 'wrong password!!' })
          .expect(401);
      }
      const locked = await request(h.http())
        .post(`${api}/auth/login`)
        .send({ email, password: PASSWORD });
      const unknown = await request(h.http())
        .post(`${api}/auth/login`)
        .send({ email: uniqueEmail('nobody'), password: PASSWORD });
      expect(locked.status).toBe(401);
      expect((locked.body as ErrorEnvelope).error.code).toBe(
        (unknown.body as ErrorEnvelope).error.code,
      );
      expect(await actions(session.user.id)).toEqual(
        expect.arrayContaining(['AUTH_LOGIN_FAILED', 'AUTH_LOCKED']),
      );
    });
  });

  describe('password reset (FR-005)', () => {
    it('should set the new password and sign out every session', async () => {
      const { email, jar, session } = await signUpCitizen(h);
      await request(h.http()).post(`${api}/auth/password/forgot`).send({ email }).expect(202);
      const code = codeFrom(h.mail, email, 'RESET_PASSWORD_CODE');
      const newPassword = 'another long phrase 9';
      await request(h.http())
        .post(`${api}/auth/password/reset`)
        .send({ email, code, password: newPassword })
        .expect(204);

      await send(jar, request(h.http()).post(`${api}/auth/refresh`)).then((r) =>
        expect(r.status).toBe(401),
      );
      await request(h.http()).get(`${api}/users/me`).set(bearer(session)).expect(401);
      await request(h.http())
        .post(`${api}/auth/login`)
        .send({ email, password: PASSWORD })
        .expect(401);
      const login = await request(h.http())
        .post(`${api}/auth/login`)
        .send({ email, password: newPassword });
      expect((login.body as LoginResponse).status).toBe('OK');
    });

    it('should answer 202 for an unknown email without sending anything', async () => {
      const before = h.mail.sent.length;
      await request(h.http())
        .post(`${api}/auth/password/forgot`)
        .send({ email: uniqueEmail('ghost') })
        .expect(202);
      expect(h.mail.sent.length).toBe(before);
    });
  });

  describe('staff device check (FR-008)', () => {
    it('should require the email code on a new device and not on a trusted one', async () => {
      const { email, jar, session } = await signUpStaff(h, 'OFFICER', 'POLICE');
      expect(session.user).toMatchObject({ role: 'OFFICER', departmentCode: 'POLICE' });
      expect(await actions(session.user.id)).toEqual(
        expect.arrayContaining(['DEVICE_TRUSTED', 'AUTH_LOGIN']),
      );
      expect(await h.prisma.trustedDevice.count({ where: { userId: session.user.id } })).toBe(1);

      // Same browser (device cookie kept): no code needed.
      const again = await send(
        jar,
        request(h.http()).post(`${api}/auth/login`).send({ email, password: PASSWORD }),
      );
      expect((again.body as LoginResponse).status).toBe('OK');

      // A different browser: challenged again.
      const other = new CookieJar();
      const fresh = await send(
        other,
        request(h.http()).post(`${api}/auth/login`).send({ email, password: PASSWORD }),
      );
      expect((fresh.body as LoginResponse).status).toBe('OTP_REQUIRED');
    });

    it('should reject the code when it is submitted from a different browser', async () => {
      const { email } = await signUpStaff(h, 'SUPERVISOR', 'CIVIL_REGISTRY');
      const started = new CookieJar();
      const login = await send(
        started,
        request(h.http()).post(`${api}/auth/login`).send({ email, password: PASSWORD }),
      );
      const { challengeId } = login.body as { challengeId: string };
      const attacker = new CookieJar();
      const res = await send(
        attacker,
        request(h.http())
          .post(`${api}/auth/login/otp`)
          .send({ challengeId, code: codeFrom(h.mail, email, 'STAFF_DEVICE_CODE') }),
      );
      expect(res.status).toBe(400);
    });
  });

  describe('purge of unverified accounts (FR-002)', () => {
    it('should delete citizens unverified for more than 7 days and audit it', async () => {
      const email = uniqueEmail('stale');
      await request(h.http())
        .post(`${api}/auth/register`)
        .send({ fullName: 'Stale Account', email, phone: '+252 61 222 2222', password: PASSWORD })
        .expect(202);
      const user = await h.prisma.user.findUniqueOrThrow({ where: { email } });
      await h.prisma.user.update({
        where: { id: user.id },
        data: { createdAt: new Date(Date.now() - 8 * 86_400_000) },
      });
      const verified = await signUpCitizen(h);

      await h.app.get(PurgeService).purgeUnverifiedCitizens();

      expect(await h.prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
      expect(
        await h.prisma.user.findUnique({ where: { id: verified.session.user.id } }),
      ).not.toBeNull();
      expect(await actions(user.id)).toContain('USER_PURGED');
    });
  });
});
