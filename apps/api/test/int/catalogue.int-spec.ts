import {
  type AdminService,
  type CatalogueServiceDetail,
  type CatalogueServiceSummary,
  type ServiceVersion,
  type Setting,
} from '@govserve/shared';
import request from 'supertest';
import { CatalogueService } from '../../src/catalogue/catalogue.service';
import { seedReferenceData } from '../../src/catalogue/seed';
import { type ErrorEnvelope } from '../../src/common/filters/error-envelope.filter';
import { bearer, type Harness, signUpCitizen, signUpStaff, startHarness } from './harness';

const api = '/api/v1';

describe('Service catalogue (integration)', () => {
  let h: Harness;
  let admin: Awaited<ReturnType<typeof signUpStaff>>;
  const as = () => bearer(admin.session);

  beforeAll(async () => {
    h = await startHarness();
    admin = await signUpStaff(h, 'ADMIN', null);
  });

  afterAll(async () => {
    await h?.close();
  });

  const serviceId = async (code: string) =>
    (await h.prisma.service.findUniqueOrThrow({ where: { code } })).id;
  const audit = (entityId: string, action: string) =>
    h.prisma.auditLog.findFirstOrThrow({ where: { entityId, action } });

  describe('seed (FR-024)', () => {
    it('should seed the three pilot services, published, with TEST fees', async () => {
      const res = await request(h.http()).get(`${api}/catalogue/services`).expect(200);
      const list = res.body as CatalogueServiceSummary[];
      expect(list.map((s) => [s.code, s.departmentCode, s.fee, s.feeProvisional]).sort()).toEqual([
        ['BIRTH_CERTIFICATE', 'CIVIL_REGISTRY', { baseCents: '2000', perCopyCents: '200' }, true],
        ['POLICE_CLEARANCE', 'POLICE', { baseCents: '1500', perCopyCents: '200' }, true],
        ['PROOF_OF_ADDRESS', 'ADDRESS', { baseCents: '1000', perCopyCents: '200' }, true],
      ]);
    });

    it('should change nothing when run again', async () => {
      const before = await h.prisma.serviceVersion.count();
      expect(await seedReferenceData(h.prisma)).toEqual({
        servicesCreated: [],
        settingsCreated: 0,
        reasonCodesCreated: 0,
      });
      expect(await h.prisma.serviceVersion.count()).toBe(before);
    });
  });

  describe('public catalogue (FR-023)', () => {
    it('should show the form, documents and fee rule without signing in', async () => {
      const res = await request(h.http())
        .get(`${api}/catalogue/services/POLICE_CLEARANCE`)
        .expect(200);
      const detail = res.body as CatalogueServiceDetail;
      expect(detail).toMatchObject({
        inPersonStep: 'FINGERPRINTS',
        slaWorkingDays: 10,
        validityMonths: 6,
        versionNo: 1,
      });
      expect(detail.requiredDocuments.map((d) => d.type)).toEqual([
        'NATIONAL_ID_OR_PASSPORT',
        'PASSPORT_PHOTO',
      ]);
      expect(Object.keys(detail.formSchema.properties)).toContain('destinationCountry');
      // Admin-only facts stay private.
      expect(detail).not.toHaveProperty('approvalMode');
    });

    it('should show an admin change at once when the public catalogue was just cached', async () => {
      const id = await serviceId('PROOF_OF_ADDRESS');
      const read = async () =>
        (await request(h.http()).get(`${api}/catalogue/services/PROOF_OF_ADDRESS`).expect(200))
          .body as CatalogueServiceDetail;
      const before = await read();
      await request(h.http())
        .patch(`${api}/admin/services/${id}`)
        .set(as())
        .send({ description: `${before.description} (updated)` })
        .expect(200);
      expect((await read()).description).toBe(`${before.description} (updated)`);
      const list = (await request(h.http()).get(`${api}/catalogue/services`).expect(200))
        .body as CatalogueServiceSummary[];
      expect(list.find((x) => x.code === 'PROOF_OF_ADDRESS')?.description).toBe(
        `${before.description} (updated)`,
      );
      await request(h.http())
        .patch(`${api}/admin/services/${id}`)
        .set(as())
        .send({ description: before.description })
        .expect(200);
    });

    it('should search by name or description, case-insensitively', async () => {
      const res = await request(h.http())
        .get(`${api}/catalogue/services`)
        .query({ q: 'CRIMINAL' })
        .expect(200);
      expect((res.body as CatalogueServiceSummary[]).map((s) => s.code)).toEqual([
        'POLICE_CLEARANCE',
      ]);
    });

    it('should return 404 for an unknown or malformed code', async () => {
      await request(h.http()).get(`${api}/catalogue/services/NOPE_NOT_REAL`).expect(404);
      await request(h.http()).get(`${api}/catalogue/services/lowercase`).expect(422);
    });
  });

  describe('versioning (FR-021, FR-022)', () => {
    it('should create a new draft when a published version is edited, leaving v1 unchanged', async () => {
      const id = await serviceId('PROOF_OF_ADDRESS');
      const v1Before = await h.prisma.serviceVersion.findFirstOrThrow({
        where: { serviceId: id, versionNo: 1 },
      });

      // Editing the published version in place is refused.
      const inPlace = await request(h.http())
        .patch(`${api}/admin/versions/${v1Before.id}`)
        .set(as())
        .send({ feeIsTest: false });
      expect(inPlace.status).toBe(409);
      expect((inPlace.body as ErrorEnvelope).error.code).toBe('VERSION_NOT_EDITABLE');

      const draft = (
        await request(h.http()).post(`${api}/admin/services/${id}/versions`).set(as()).expect(201)
      ).body as ServiceVersion;
      expect(draft).toMatchObject({
        versionNo: 2,
        status: 'DRAFT',
        fee: { baseCents: '1000', perCopyCents: '200' },
      });
      await request(h.http()).post(`${api}/admin/services/${id}/versions`).set(as()).expect(409);

      await request(h.http())
        .patch(`${api}/admin/versions/${draft.id}`)
        .set(as())
        .send({ fee: { baseCents: '1250', perCopyCents: '250' } })
        .expect(200);
      const published = (
        await request(h.http())
          .post(`${api}/admin/versions/${draft.id}/publish`)
          .set(as())
          .expect(200)
      ).body as ServiceVersion;
      expect(published).toMatchObject({ versionNo: 2, status: 'PUBLISHED' });

      const v1After = await h.prisma.serviceVersion.findUniqueOrThrow({
        where: { id: v1Before.id },
      });
      expect({
        ...v1After,
        status: 'PUBLISHED',
        retiredAt: null,
        updatedAt: v1Before.updatedAt,
      }).toEqual(v1Before);
      expect(v1After.status).toBe('RETIRED');
      expect(
        await h.prisma.serviceVersion.count({ where: { serviceId: id, status: 'PUBLISHED' } }),
      ).toBe(1);

      const live = (
        await request(h.http()).get(`${api}/catalogue/services/PROOF_OF_ADDRESS`).expect(200)
      ).body as CatalogueServiceDetail;
      expect(live).toMatchObject({ versionNo: 2, fee: { baseCents: '1250', perCopyCents: '250' } });

      const pub = await audit(draft.id, 'SERVICE_VERSION_PUBLISHED');
      expect(pub.before).toMatchObject({ status: 'DRAFT', previousVersionNo: 1 });
      expect(pub.after).toMatchObject({ versionNo: 2, feeBaseCents: '1250' });
      expect((await audit(v1Before.id, 'SERVICE_VERSION_RETIRED')).after).toMatchObject({
        status: 'RETIRED',
        replacedBy: 2,
      });
    });

    it('should refuse to publish an invalid form with 422 and list the problems', async () => {
      const id = await serviceId('BIRTH_CERTIFICATE');
      const draft = (
        await request(h.http()).post(`${api}/admin/services/${id}/versions`).set(as()).expect(201)
      ).body as ServiceVersion;
      await request(h.http())
        .patch(`${api}/admin/versions/${draft.id}`)
        .set(as())
        .send({ uiSchema: { order: ['relationship'] } })
        .expect(200);
      const res = await request(h.http())
        .post(`${api}/admin/versions/${draft.id}/publish`)
        .set(as());
      expect(res.status).toBe(422);
      expect((res.body as ErrorEnvelope).error.code).toBe('VERSION_INVALID');
      expect(JSON.stringify((res.body as ErrorEnvelope).error.details)).toContain(
        'uiSchema.order is missing',
      );

      // Discarding the draft is allowed; the published version is untouched.
      await request(h.http()).delete(`${api}/admin/versions/${draft.id}`).set(as()).expect(204);
      expect(
        await h.prisma.serviceVersion.count({ where: { serviceId: id, status: 'PUBLISHED' } }),
      ).toBe(1);
    });

    it('should take a service off the public catalogue when its version is retired', async () => {
      const created = (
        await request(h.http())
          .post(`${api}/admin/services`)
          .set(as())
          .send({
            code: 'TEST_PERMIT',
            departmentCode: 'ADDRESS',
            certificatePrefix: 'TST',
            name: 'Test permit',
            description: 'A service created by the integration test.',
            active: true,
            slaWorkingDays: 3,
            inPersonStep: 'NONE',
            approvalMode: 'SINGLE',
            validityMonths: 12,
            subjectMode: 'SELF',
          })
          .expect(201)
      ).body as AdminService;
      expect(created.publishedVersionNo).toBeNull();
      await request(h.http()).get(`${api}/catalogue/services/TEST_PERMIT`).expect(404);

      await request(h.http())
        .post(`${api}/admin/versions/${created.draftVersionId}/publish`)
        .set(as())
        .expect(200);
      await request(h.http()).get(`${api}/catalogue/services/TEST_PERMIT`).expect(200);
      await request(h.http())
        .post(`${api}/admin/versions/${created.draftVersionId}/retire`)
        .set(as())
        .expect(200);
      await request(h.http()).get(`${api}/catalogue/services/TEST_PERMIT`).expect(404);
      await request(h.http())
        .post(`${api}/admin/versions/${created.draftVersionId}/retire`)
        .set(as())
        .expect(409);
      expect((await audit(created.id, 'SERVICE_CREATED')).after).toMatchObject({
        code: 'TEST_PERMIT',
      });
    });

    it('should audit service updates with before and after values', async () => {
      const id = await serviceId('POLICE_CLEARANCE');
      await request(h.http())
        .patch(`${api}/admin/services/${id}`)
        .set(as())
        .send({ slaWorkingDays: 12 })
        .expect(200);
      const row = await audit(id, 'SERVICE_UPDATED');
      expect(row.before).toEqual({ slaWorkingDays: 10 });
      expect(row.after).toEqual({ slaWorkingDays: 12 });
    });
  });

  describe('server-side form validation (FR-033)', () => {
    it('should validate submitted data against the exact version with field messages', async () => {
      const version = await h.prisma.serviceVersion.findFirstOrThrow({
        where: { service: { code: 'POLICE_CLEARANCE' }, status: 'PUBLISHED' },
      });
      const svc = h.app.get(CatalogueService);
      await expect(svc.validateFormData(version.id, { fullName: 'A' })).rejects.toMatchObject({
        status: 422,
      });
      await expect(
        svc.validateFormData(version.id, {
          fullName: 'Amina Hassan',
          dateOfBirth: '1990-04-12',
          placeOfBirth: 'Mogadishu',
          idNumber: 'SO1234567',
          mothersFullName: 'Halima Yusuf',
          currentAddress: 'Hodan district, near the market',
          purpose: 'EMPLOYMENT',
        }),
      ).resolves.toMatchObject({ purpose: 'EMPLOYMENT' });
    });
  });

  describe('settings, holidays and reason codes (FR-140)', () => {
    it('should validate a setting against its schema and audit before/after', async () => {
      const list = (await request(h.http()).get(`${api}/admin/settings`).set(as()).expect(200))
        .body as Setting[];
      expect(list.find((s) => s.key === 'payment.supervisorThresholdCents')?.value).toBe('10000');

      const bad = await request(h.http())
        .put(`${api}/admin/settings/payment.supervisorThresholdCents`)
        .set(as())
        .send({ value: 100.5 });
      expect(bad.status).toBe(422);
      await request(h.http())
        .put(`${api}/admin/settings/not.a.setting`)
        .set(as())
        .send({ value: 1 })
        .expect(404);

      await request(h.http())
        .put(`${api}/admin/settings/payment.supervisorThresholdCents`)
        .set(as())
        .send({ value: '15000' })
        .expect(200);
      const row = await audit('payment.supervisorThresholdCents', 'SETTING_UPDATED');
      expect(row.before).toEqual({ value: '10000' });
      expect(row.after).toEqual({ value: '15000' });
    });

    it('should add and remove holidays, refusing duplicates', async () => {
      await request(h.http())
        .post(`${api}/admin/holidays`)
        .set(as())
        .send({ date: '2026-07-01', name: 'Independence Day' })
        .expect(201);
      await request(h.http())
        .post(`${api}/admin/holidays`)
        .set(as())
        .send({ date: '2026-07-01', name: 'Again' })
        .expect(409);
      await request(h.http()).delete(`${api}/admin/holidays/2026-07-01`).set(as()).expect(204);
      await request(h.http()).delete(`${api}/admin/holidays/2026-07-01`).set(as()).expect(404);
      expect(await h.prisma.auditLog.count({ where: { entityId: '2026-07-01' } })).toBe(2);
    });

    it('should add and deactivate reason codes but never duplicate them', async () => {
      const created = await request(h.http())
        .post(`${api}/admin/reason-codes`)
        .set(as())
        .send({ kind: 'REJECT', code: 'EXPIRED_DOCUMENT', label: 'Identity document has expired' })
        .expect(201);
      await request(h.http())
        .post(`${api}/admin/reason-codes`)
        .set(as())
        .send({ kind: 'REJECT', code: 'EXPIRED_DOCUMENT', label: 'Duplicate' })
        .expect(409);
      const id = (created.body as { id: string }).id;
      await request(h.http())
        .patch(`${api}/admin/reason-codes/${id}`)
        .set(as())
        .send({ active: false })
        .expect(200);
      expect((await audit(id, 'REASON_CODE_UPDATED')).after).toMatchObject({ active: false });
    });
  });

  describe('authorization', () => {
    it('should return 403 on every admin catalogue endpoint for citizens and officers', async () => {
      const citizen = await signUpCitizen(h);
      const officer = await signUpStaff(h, 'OFFICER', 'POLICE');
      const id = await serviceId('POLICE_CLEARANCE');
      for (const who of [citizen.session, officer.session]) {
        await request(h.http()).get(`${api}/admin/services`).set(bearer(who)).expect(403);
        await request(h.http())
          .post(`${api}/admin/services/${id}/versions`)
          .set(bearer(who))
          .expect(403);
        await request(h.http()).get(`${api}/admin/settings`).set(bearer(who)).expect(403);
        await request(h.http())
          .post(`${api}/admin/holidays`)
          .set(bearer(who))
          .send({ date: '2026-01-01', name: 'x' })
          .expect(403);
      }
      await request(h.http()).get(`${api}/admin/services`).expect(401);
    });
  });
});
