import { type Profile, type StaffMember } from '@govserve/shared';
import request from 'supertest';
import { type ErrorEnvelope } from '../../src/common/filters/error-envelope.filter';
import {
  bearer,
  codeFrom,
  type Harness,
  PASSWORD,
  send,
  signUpCitizen,
  signUpStaff,
  startHarness,
  uniqueEmail,
} from './harness';

const api = '/api/v1';

describe('Users, staff and authorization (integration)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });

  afterAll(async () => {
    await h?.close();
  });

  describe('ownership and roles', () => {
    it('should return 401 without a token on a protected endpoint', async () => {
      const res = await request(h.http()).get(`${api}/users/me`);
      expect(res.status).toBe(401);
      expect((res.body as ErrorEnvelope).error.code).toBe('UNAUTHENTICATED');
    });

    it('should return 404 when a citizen reads another citizen profile', async () => {
      const a = await signUpCitizen(h);
      const b = await signUpCitizen(h);
      await request(h.http())
        .get(`${api}/users/${b.session.user.id}`)
        .set(bearer(a.session))
        .expect(404);
      await request(h.http())
        .get(`${api}/users/${a.session.user.id}`)
        .set(bearer(a.session))
        .expect(200);
    });

    it('should return 403 when a citizen or officer calls an admin endpoint', async () => {
      const citizen = await signUpCitizen(h);
      const officer = await signUpStaff(h, 'OFFICER', 'ADDRESS');
      await request(h.http()).get(`${api}/staff`).set(bearer(citizen.session)).expect(403);
      await request(h.http()).get(`${api}/staff`).set(bearer(officer.session)).expect(403);
      // Officers cannot read arbitrary user profiles either.
      await request(h.http())
        .get(`${api}/users/${citizen.session.user.id}`)
        .set(bearer(officer.session))
        .expect(403);
    });

    it('should let an admin read any profile', async () => {
      const admin = await signUpStaff(h, 'ADMIN', null);
      const citizen = await signUpCitizen(h);
      await request(h.http())
        .get(`${api}/users/${citizen.session.user.id}`)
        .set(bearer(admin.session))
        .expect(200);
    });
  });

  describe('profile and PII (FR-010, NFR-002)', () => {
    it('should store the national ID encrypted, return it masked and enforce uniqueness', async () => {
      const a = await signUpCitizen(h);
      const res = await request(h.http())
        .patch(`${api}/users/me`)
        .set(bearer(a.session))
        .send({ nationalIdType: 'NATIONAL_ID', nationalId: 'SO1234567', dateOfBirth: '1990-04-12' })
        .expect(200);
      expect(res.body).toMatchObject({ nationalIdMasked: '••••••567', dateOfBirth: '1990-04-12' });

      const row = await h.prisma.citizenProfile.findUniqueOrThrow({
        where: { userId: a.session.user.id },
      });
      expect(Buffer.from(row.nationalIdEnc!).toString('utf8')).not.toContain('SO1234567');
      expect(Buffer.from(row.dateOfBirthEnc!).toString('utf8')).not.toContain('1990');

      const b = await signUpCitizen(h);
      const dup = await request(h.http())
        .patch(`${api}/users/me`)
        .set(bearer(b.session))
        .send({ nationalId: 'so 1234567' });
      expect(dup.status).toBe(409);
      expect((dup.body as ErrorEnvelope).error.code).toBe('NATIONAL_ID_IN_USE');

      const audit = await h.prisma.auditLog.findFirstOrThrow({
        where: { entityId: a.session.user.id, action: 'USER_PROFILE_UPDATED' },
      });
      expect(JSON.stringify(audit.after)).not.toContain('SO1234567');
    });

    it('should refuse identity fields for staff with 403', async () => {
      const officer = await signUpStaff(h, 'OFFICER', 'POLICE');
      const res = await request(h.http())
        .patch(`${api}/users/me`)
        .set(bearer(officer.session))
        .send({ nationalId: 'SO999' });
      expect(res.status).toBe(403);
    });

    it('should change email only after the code sent to the new address is confirmed', async () => {
      const a = await signUpCitizen(h);
      const newEmail = uniqueEmail('changed');
      await request(h.http())
        .post(`${api}/users/me/email`)
        .set(bearer(a.session))
        .send({ newEmail })
        .expect(202);
      const code = codeFrom(h.mail, newEmail, 'CHANGE_EMAIL_CODE');
      const res = await request(h.http())
        .post(`${api}/users/me/email/confirm`)
        .set(bearer(a.session))
        .send({ code });
      expect(res.status).toBe(200);
      expect((res.body as Profile).email).toBe(newEmail);
    });
  });

  describe('staff administration (FR-007, FR-009)', () => {
    it('should invite, list, change role and audit with before/after', async () => {
      const admin = await signUpStaff(h, 'ADMIN', null);
      const email = uniqueEmail('invitee');
      const invited = await request(h.http())
        .post(`${api}/staff/invitations`)
        .set(bearer(admin.session))
        .send({ email, fullName: 'Invited Officer', role: 'OFFICER', departmentCode: 'POLICE' });
      expect(invited.status).toBe(201);
      expect(h.mail.last(email, 'STAFF_INVITATION')?.vars['link']).toContain('/invitation?token=');

      const officer = await signUpStaff(h, 'OFFICER', 'POLICE');
      const changed = await request(h.http())
        .patch(`${api}/staff/${officer.session.user.id}`)
        .set(bearer(admin.session))
        .send({ role: 'SUPERVISOR', departmentCode: 'POLICE' });
      expect(changed.status).toBe(200);
      expect((changed.body as StaffMember).role).toBe('SUPERVISOR');
      // Old token carried the old role: it no longer works.
      await request(h.http()).get(`${api}/users/me`).set(bearer(officer.session)).expect(401);

      const audit = await h.prisma.auditLog.findFirstOrThrow({
        where: { entityId: officer.session.user.id, action: 'USER_ROLE_CHANGED' },
      });
      expect(audit.before).toMatchObject({ role: 'OFFICER' });
      expect(audit.after).toMatchObject({ role: 'SUPERVISOR' });

      const list = await request(h.http())
        .get(`${api}/staff`)
        .set(bearer(admin.session))
        .expect(200);
      expect((list.body as StaffMember[]).some((s) => s.id === officer.session.user.id)).toBe(true);
    });

    it('should reject an officer invitation without a department with 422', async () => {
      const admin = await signUpStaff(h, 'ADMIN', null);
      const res = await request(h.http())
        .post(`${api}/staff/invitations`)
        .set(bearer(admin.session))
        .send({ email: uniqueEmail('nodept'), fullName: 'No Department', role: 'OFFICER' });
      expect(res.status).toBe(422);
    });

    it('should kill all sessions immediately when a staff member is deactivated', async () => {
      const admin = await signUpStaff(h, 'ADMIN', null);
      const officer = await signUpStaff(h, 'OFFICER', 'CIVIL_REGISTRY');
      await request(h.http())
        .post(`${api}/staff/${officer.session.user.id}/deactivate`)
        .set(bearer(admin.session))
        .expect(200);

      await request(h.http()).get(`${api}/users/me`).set(bearer(officer.session)).expect(401);
      await send(officer.jar, request(h.http()).post(`${api}/auth/refresh`)).then((r) =>
        expect(r.status).toBe(401),
      );
      await request(h.http())
        .post(`${api}/auth/login`)
        .send({ email: officer.email, password: PASSWORD })
        .expect(401);
      expect(
        await h.prisma.auditLog.count({
          where: { entityId: officer.session.user.id, action: 'USER_DEACTIVATED' },
        }),
      ).toBe(1);
    });

    it('should not let an admin deactivate themselves', async () => {
      const admin = await signUpStaff(h, 'ADMIN', null);
      const res = await request(h.http())
        .post(`${api}/staff/${admin.session.user.id}/deactivate`)
        .set(bearer(admin.session));
      expect(res.status).toBe(400);
    });
  });
});
