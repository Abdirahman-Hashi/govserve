import {
  type ApplicationDetail,
  type AuditPage,
  type AuditVerification,
  type NotificationPage,
} from '@govserve/shared';
import request from 'supertest';
import { generateKeyPairSync } from 'node:crypto';
import { AuditVerifierService } from '../../src/audit/audit-verifier.service';
import { AuditService } from '../../src/audit/audit.service';
import { MetricsService } from '../../src/metrics/metrics.service';
import { APP_CONFIG, type AppConfig } from '../../src/config/config.module';
import { SigningService } from '../../src/receipts/signing.service';
import { type ErrorEnvelope } from '../../src/common/filters/error-envelope.filter';
import { PurgeService } from '../../src/jobs/purge.service';
import { RetentionService } from '../../src/jobs/retention.service';
import { STORAGE_PORT, type StoragePort } from '../../src/storage/storage.port';
import {
  bearer,
  FILES,
  type Harness,
  signUpCitizen,
  signUpStaff,
  startHarness,
  upload,
  waitForDocument,
} from './harness';

const api = '/api/v1';
type Staff = Awaited<ReturnType<typeof signUpStaff>>;
const DAY = 86_400_000;

async function until<T>(
  fn: () => Promise<T | null | undefined | false>,
  timeout = 10_000,
): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('Audit trail and retention (integration)', () => {
  let h: Harness;
  let admin: Staff;
  let addrSup: Staff;
  let polSup: Staff;
  let addrOfficer: Staff;

  beforeAll(async () => {
    h = await startHarness();
    [admin, addrSup, polSup, addrOfficer] = [
      await signUpStaff(h, 'ADMIN', null),
      await signUpStaff(h, 'SUPERVISOR', 'ADDRESS'),
      await signUpStaff(h, 'SUPERVISOR', 'POLICE'),
      await signUpStaff(h, 'OFFICER', 'ADDRESS'),
    ];
  });

  afterAll(async () => {
    await h?.close();
  });

  const verify = async () =>
    (await request(h.http()).post(`${api}/audit/verify`).set(bearer(admin.session)).expect(200))
      .body as AuditVerification;

  /** A citizen draft for proof of address with one uploaded, scanned document. */
  async function draftWithDocument() {
    const citizen = await signUpCitizen(h);
    const app = (
      await request(h.http())
        .post(`${api}/applications`)
        .set(bearer(citizen.session))
        .send({ serviceCode: 'PROOF_OF_ADDRESS' })
        .expect(201)
    ).body as ApplicationDetail;
    const u = await upload(h, citizen.session, app.id, 'NATIONAL_ID_OR_PASSPORT', FILES.pdf());
    await waitForDocument(h, u.ticket.document.id, 'CLEAN');
    return { citizen, app, documentId: u.ticket.document.id };
  }

  describe('hash chain', () => {
    it('should chain rows in commit order, even when written concurrently', async () => {
      await Promise.all(Array.from({ length: 8 }, () => signUpCitizen(h)));
      const rows = await h.prisma.auditLog.findMany({ orderBy: { chainSeq: 'asc' } });
      expect(rows.every((r) => r.chainSeq !== null && r.hash?.length === 32)).toBe(true);
      for (let i = 1; i < rows.length; i++) {
        expect(Buffer.from(rows[i]!.prevHash!).equals(Buffer.from(rows[i - 1]!.hash!))).toBe(true);
      }
      expect(await verify()).toMatchObject({ ok: true, broken: null });
    });

    it('should refuse UPDATE and DELETE to the application role and to the owner', async () => {
      const row = await h.prisma.auditLog.findFirstOrThrow();
      await expect(
        h.prisma.$executeRaw`UPDATE "audit_log" SET "action" = 'X' WHERE "id" = ${row.id}`,
      ).rejects.toThrow(/permission denied|append-only/);
      await expect(
        h.prisma.$executeRaw`DELETE FROM "audit_log" WHERE "id" = ${row.id}`,
      ).rejects.toThrow(/permission denied|append-only/);
      await expect(
        h.owner.$executeRaw`UPDATE "audit_log" SET "action" = 'X' WHERE "id" = ${row.id}`,
      ).rejects.toThrow(/append-only/);
      await expect(h.owner.$executeRawUnsafe('TRUNCATE "audit_log"')).rejects.toThrow(
        /append-only/,
      );
    });

    it('should write audit rows for boot-time signing keys and seeded defaults', async () => {
      expect(await h.prisma.auditLog.count({ where: { action: 'SIGNING_KEY_REGISTERED' } })).toBe(
        1,
      );
      expect(
        await h.prisma.auditLog.count({ where: { action: 'SETTING_DEFAULTED' } }),
      ).toBeGreaterThan(5);
      expect(
        await h.prisma.auditLog.count({ where: { action: 'REASON_CODE_CREATED' } }),
      ).toBeGreaterThan(5);
    });
  });

  describe('signing key rotation', () => {
    it('should audit a new key, the old key retiring and a key coming back', async () => {
      const config = h.app.get<AppConfig>(APP_CONFIG);
      const current = config.SIGNING_KEYS[0]!;
      const der = generateKeyPairSync('ed25519').privateKey.export({
        format: 'der',
        type: 'pkcs8',
      });
      const next = { id: `k-rot-${Date.now()}`, der: Buffer.from(der) };
      const boot = (keys: AppConfig['SIGNING_KEYS']) =>
        new SigningService(
          { ...config, SIGNING_KEYS: keys },
          h.prisma,
          h.app.get(AuditService),
        ).onModuleInit();
      await boot([next, current]); // rotate: the new key signs, the old one only verifies
      await boot([current, next]); // roll back
      await boot([current, next]); // nothing changed: nothing written
      const rows = await h.prisma.auditLog.findMany({
        where: { entityType: 'SigningKey', entityId: { in: [current.id, next.id] } },
        orderBy: { chainSeq: 'asc' },
      });
      expect(rows.map((r) => [r.entityId === next.id ? 'next' : 'current', r.action])).toEqual([
        ['current', 'SIGNING_KEY_REGISTERED'],
        ['next', 'SIGNING_KEY_REGISTERED'],
        ['current', 'SIGNING_KEY_RETIRED'],
        ['current', 'SIGNING_KEY_ACTIVATED'],
        ['next', 'SIGNING_KEY_RETIRED'],
      ]);
    });
  });

  describe('viewer', () => {
    it('should scope supervisors to their department and keep auth rows admin-only', async () => {
      const { app } = await draftWithDocument();
      const mine = (
        await request(h.http())
          .get(`${api}/audit`)
          .query({ entityId: app.id })
          .set(bearer(addrSup.session))
          .expect(200)
      ).body as AuditPage;
      expect(mine.items.map((i) => i.action)).toContain('APPLICATION_CREATED');
      expect(mine.items[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
      const theirs = (
        await request(h.http())
          .get(`${api}/audit`)
          .query({ entityId: app.id })
          .set(bearer(polSup.session))
          .expect(200)
      ).body as AuditPage;
      expect(theirs.items).toHaveLength(0);
      const auth = (
        await request(h.http())
          .get(`${api}/audit`)
          .query({ action: 'USER_REGISTERED' })
          .set(bearer(addrSup.session))
          .expect(200)
      ).body as AuditPage;
      expect(auth.items).toHaveLength(0);
      const all = (
        await request(h.http())
          .get(`${api}/audit`)
          .query({ action: 'USER_REGISTERED' })
          .set(bearer(admin.session))
          .expect(200)
      ).body as AuditPage;
      expect(all.items.length).toBeGreaterThan(0);
      await request(h.http()).get(`${api}/audit`).set(bearer(addrOfficer.session)).expect(403);
      await request(h.http()).post(`${api}/audit/verify`).set(bearer(addrSup.session)).expect(403);
    });

    it('should show the full history of an application, including its documents, oldest first', async () => {
      const { app, documentId } = await draftWithDocument();
      const history = (
        await request(h.http())
          .get(`${api}/audit/applications/${app.id}`)
          .set(bearer(addrSup.session))
          .expect(200)
      ).body as AuditPage;
      const actions = history.items.map((i) => i.action);
      expect(actions[0]).toBe('APPLICATION_CREATED');
      expect(actions).toEqual(
        expect.arrayContaining([
          'DOCUMENT_UPLOAD_REQUESTED',
          'DOCUMENT_UPLOADED',
          'DOCUMENT_CLEAN',
        ]),
      );
      expect(
        history.items
          .filter((i) => i.entityType === 'Document')
          .every((i) => i.entityId === documentId),
      ).toBe(true);
      await request(h.http())
        .get(`${api}/audit/applications/${app.id}`)
        .set(bearer(polSup.session))
        .expect(403);
    });

    it('should page by chain position and audit exports', async () => {
      const first = (
        await request(h.http()).get(`${api}/audit`).set(bearer(admin.session)).expect(200)
      ).body as AuditPage;
      expect(first.items).toHaveLength(50);
      const second = (
        await request(h.http())
          .get(`${api}/audit`)
          .query({ cursor: first.nextCursor! })
          .set(bearer(admin.session))
          .expect(200)
      ).body as AuditPage;
      expect(BigInt(second.items[0]!.chainSeq)).toBeLessThan(BigInt(first.items.at(-1)!.chainSeq));
      const csv = await request(h.http())
        .get(`${api}/audit/export.csv`)
        .query({ action: 'APPLICATION_CREATED' })
        .set(bearer(addrSup.session))
        .buffer(true)
        .parse((res, cb) => {
          let data = '';
          res.on('data', (c: Buffer) => (data += c.toString('utf8')));
          res.on('end', () => cb(null, data));
        })
        .expect(200);
      expect((csv.body as string).split('\r\n')[0]).toContain('Seq,When,Actor type');
      expect(
        await h.prisma.auditLog.count({
          where: { action: 'AUDIT_EXPORTED', actorId: addrSup.session.user.id },
        }),
      ).toBe(1);
    });
  });

  describe('retention', () => {
    it('should delete uploads of closed applications, keep the rows, audit it and answer 410', async () => {
      const { citizen, app, documentId } = await draftWithDocument();
      const doc = await h.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
      const storage = h.app.get<StoragePort>(STORAGE_PORT);
      expect(await storage.head(doc.storageKey)).not.toBeNull();
      await h.prisma.application.update({
        where: { id: app.id },
        data: { status: 'WITHDRAWN', decidedAt: new Date(Date.now() - 91 * DAY) },
      });
      expect(await h.app.get(RetentionService).purgeClosedUploads(90)).toBe(1);
      expect(await storage.head(doc.storageKey)).toBeNull();
      const after = await h.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
      expect(after.purgedAt).not.toBeNull();
      expect(
        await h.prisma.auditLog.count({ where: { entityId: app.id, action: 'DOCUMENTS_PURGED' } }),
      ).toBe(1);
      const res = await request(h.http())
        .get(`${api}/documents/${documentId}/download`)
        .set(bearer(citizen.session))
        .expect(410);
      expect((res.body as ErrorEnvelope).error.code).toBe('DOCUMENT_PURGED');
      const detail = (
        await request(h.http())
          .get(`${api}/applications/${app.id}`)
          .set(bearer(citizen.session))
          .expect(200)
      ).body as ApplicationDetail;
      expect(detail.documents.find((d) => d.id === documentId)?.purged).toBe(true);
      // Running again changes nothing.
      expect(await h.app.get(RetentionService).purgeClosedUploads(90)).toBe(0);
    });

    it('should keep decided documents until the retention period ends', async () => {
      const { app, documentId } = await draftWithDocument();
      await h.prisma.application.update({
        where: { id: app.id },
        data: { status: 'ISSUED', decidedAt: new Date(Date.now() - 6 * 365 * DAY) },
      });
      const retention = h.app.get(RetentionService);
      expect(await retention.purgeDecidedDocuments(7)).toBe(0);
      await h.prisma.application.update({
        where: { id: app.id },
        data: { decidedAt: new Date(Date.now() - 8 * 365 * DAY) },
      });
      expect(await retention.purgeDecidedDocuments(7)).toBe(1);
      expect(
        (await h.prisma.document.findUniqueOrThrow({ where: { id: documentId } })).purgedAt,
      ).not.toBeNull();
    });

    it('should prune dispatched outbox rows and auth artifacts with an audit row, keeping notifications', async () => {
      const citizen = await signUpCitizen(h);
      await h.prisma.outboxEvent.create({
        data: {
          type: 'APPLICATION_REFERRED',
          aggregateType: 'Application',
          aggregateId: '00000000-0000-0000-0000-000000000000',
          payload: {},
          dispatchedAt: new Date(Date.now() - 40 * DAY),
        },
      });
      // A notification whose event is old enough to prune.
      const old = await h.prisma.outboxEvent.create({
        data: {
          type: 'X',
          aggregateType: 'X',
          aggregateId: 'x',
          payload: {},
          dispatchedAt: new Date(Date.now() - 40 * DAY),
        },
      });
      const n = await h.prisma.notification.create({
        data: {
          userId: citizen.session.user.id,
          eventId: old.id,
          template: 'APPLICATION_WITHDRAWN',
          vars: {},
          status: 'SENT',
        },
      });
      expect(await h.app.get(RetentionService).pruneOutbox(30)).toBeGreaterThanOrEqual(2);
      expect(
        (await h.prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).eventId,
      ).toBeNull();
      const page = (
        await request(h.http()).get(`${api}/notifications`).set(bearer(citizen.session)).expect(200)
      ).body as NotificationPage;
      expect(page.items.map((i) => i.id)).toContain(n.id);
      await h.prisma.otpCode.updateMany({ data: { expiresAt: new Date(Date.now() - 40 * DAY) } });
      const pruned = await h.app.get(PurgeService).pruneAuthArtifacts(30);
      expect(pruned.otpCodes).toBeGreaterThan(0);
      const audit = await h.prisma.auditLog.findMany({ where: { action: 'RETENTION_PRUNED' } });
      expect(audit.map((a) => a.entityId).sort()).toEqual(['auth-artifacts', 'outbox']);
      // Money, receipts, certificates and audit rows are never removed by retention.
      expect(await h.prisma.auditLog.count()).toBeGreaterThan(0);
    });
  });

  // Last: these deliberately break the chain (and repair it) as a superuser would.
  describe('tamper detection', () => {
    /** Runs SQL as the owner with triggers off, i.e. bypassing every guard, as an attacker with superuser would. */
    const asSuperuser = (sql: string) =>
      h.owner.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.$executeRawUnsafe(sql);
      });

    it('should report an edited row, notify admins, and pass again once repaired', async () => {
      await signUpCitizen(h); // its USER_REGISTERED row is the one tampered with
      expect((await verify()).ok).toBe(true);
      const target = await h.prisma.auditLog.findFirstOrThrow({
        where: { action: 'USER_REGISTERED' },
        orderBy: { chainSeq: 'asc' },
      });
      await asSuperuser(
        `UPDATE "audit_log" SET "action" = 'USER_REGISTERED_X' WHERE "id" = ${target.id}`,
      );
      const result = await verify();
      expect(result).toMatchObject({
        ok: false,
        broken: { chainSeq: target.chainSeq!.toString(), problem: 'ROW_CHANGED' },
      });
      await until(() =>
        h.prisma.notification.findFirst({
          where: { userId: admin.session.user.id, template: 'AUDIT_CHAIN_BROKEN' },
        }),
      );
      expect(h.mail.last(admin.email, 'AUDIT_CHAIN_BROKEN')?.vars['chainSeq']).toBe(
        target.chainSeq!.toString(),
      );
      expect((await h.app.get(MetricsService).auditChainOk.get()).values[0]?.value).toBe(0);
      await asSuperuser(
        `UPDATE "audit_log" SET "action" = 'USER_REGISTERED' WHERE "id" = ${target.id}`,
      );
      expect((await verify()).ok).toBe(true);
    });

    it('should report rows removed from the end using the last checkpoint, and pass once restored', async () => {
      // A passing run records a checkpoint at the current head.
      expect((await verify()).ok).toBe(true);
      const head = await h.prisma.auditLog.findFirstOrThrow({ orderBy: { chainSeq: 'desc' } });
      await h.owner.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.$executeRawUnsafe(
          `CREATE TABLE "audit_tail_copy" AS SELECT * FROM "audit_log" WHERE "id" = ${head.id}`,
        );
        await tx.$executeRawUnsafe(`DELETE FROM "audit_log" WHERE "id" = ${head.id}`);
      });
      // The chain itself still links up; only the checkpoint shows the head is gone.
      const result = await h.app.get(AuditVerifierService).verify();
      expect(result).toMatchObject({
        ok: false,
        broken: { chainSeq: head.chainSeq!.toString(), problem: 'TAIL_REMOVED' },
      });
      await h.owner.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.$executeRawUnsafe('INSERT INTO "audit_log" SELECT * FROM "audit_tail_copy"');
        await tx.$executeRawUnsafe('DROP TABLE "audit_tail_copy"');
      });
      expect((await verify()).ok).toBe(true);
    });

    it('should report a deleted row at the next link', async () => {
      const [a, b] = await h.prisma.auditLog.findMany({
        orderBy: { chainSeq: 'asc' },
        take: 2,
        skip: 3,
      });
      await asSuperuser(`DELETE FROM "audit_log" WHERE "id" = ${a!.id}`);
      expect(await verify()).toMatchObject({
        ok: false,
        broken: { chainSeq: b!.chainSeq!.toString(), problem: 'LINK_BROKEN' },
      });
    });
  });
});
