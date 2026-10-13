import { getQueueToken } from '@nestjs/bullmq';
import { type ApplicationDetail, type AuthSession, type NotificationPage } from '@govserve/shared';
import { type Queue } from 'bullmq';
import request from 'supertest';
import { NotificationDeliveryError } from '../../src/notifications/notification-delivery.error';
import { OutboxRelayService } from '../../src/notifications/outbox-relay.service';
import { NOTIFY_DEAD_QUEUE } from '../../src/notifications/queues';
import { ReviewService } from '../../src/review/review.service';
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
const ANSWERS = {
  fullName: 'Amina Hassan Warsame',
  dateOfBirth: '1990-04-12',
  idNumber: 'SO7654321',
  phone: '+252 61 234 5678',
  email: 'amina@example.com',
  district: 'Hodan',
  neighbourhood: 'Taleex',
  streetOrLandmark: 'Near the Taleex junction',
  yearsAtAddress: 4,
  tenure: 'RENT',
};

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

describe('Notifications (integration)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });

  afterEach(() => {
    h.mail.failWith = null;
  });

  afterAll(async () => {
    await h?.close();
  });

  /** A citizen with a submitted proof-of-address application (awaiting payment). */
  async function submitted(existing?: { session: AuthSession; email: string }) {
    const citizen = existing ?? (await signUpCitizen(h));
    const app = (
      await request(h.http())
        .post(`${api}/applications`)
        .set(bearer(citizen.session))
        .send({ serviceCode: 'PROOF_OF_ADDRESS' })
        .expect(201)
    ).body as ApplicationDetail;
    await request(h.http())
      .patch(`${api}/applications/${app.id}`)
      .set(bearer(citizen.session))
      .send({ formData: ANSWERS })
      .expect(200);
    for (const docType of ['NATIONAL_ID_OR_PASSPORT', 'UTILITY_BILL']) {
      const u = await upload(h, citizen.session, app.id, docType, FILES.pdf());
      await waitForDocument(h, u.ticket.document.id, 'CLEAN');
    }
    const res = await request(h.http())
      .post(`${api}/applications/${app.id}/submit`)
      .set(bearer(citizen.session))
      .expect(200);
    return { ...citizen, app: res.body as ApplicationDetail };
  }

  const rowFor = (applicationId: string, template: string, status?: string) =>
    until(() =>
      h.prisma.notification.findFirst({
        where: {
          template,
          vars: { path: ['applicationId'], equals: applicationId },
          ...(status && { status: status as never }),
        },
      }),
    );

  /** A synthetic event for an application (as the state services write them). */
  const event = (type: string, applicationId: string) =>
    h.prisma.outboxEvent.create({
      data: {
        type,
        aggregateType: 'Application',
        aggregateId: applicationId,
        payload: { applicationId },
      },
    });

  it('should email the applicant from the outbox with no PII beyond first name and reference', async () => {
    const { email, app } = await submitted();
    const row = await rowFor(app.id, 'APPLICATION_SUBMITTED', 'SENT');
    expect(row).toMatchObject({ mandatory: false, attempts: 1, channel: 'EMAIL' });
    expect(row.providerMessageId).toMatch(/^mem-/);
    const sent = h.mail.last(email, 'APPLICATION_SUBMITTED')!;
    expect(sent.vars).toMatchObject({
      firstName: 'Amina',
      referenceNo: app.referenceNo,
      link: `http://localhost:5173/citizen/applications/${app.id}`,
    });
    expect(JSON.stringify(sent)).not.toMatch(/SO7654321|Taleex|252 61/);
  });

  it('should not send again when an event is replayed', async () => {
    const { email, app } = await submitted();
    await rowFor(app.id, 'APPLICATION_SUBMITTED', 'SENT');
    const before = h.mail.sent.filter((m) => m.to === email).length;
    const ev = await h.prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId: app.id, type: 'APPLICATION_SUBMITTED' },
    });
    await h.prisma.outboxEvent.update({ where: { id: ev.id }, data: { dispatchedAt: null } });
    await until(async () =>
      (await h.prisma.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } })).dispatchedAt
        ? true
        : null,
    );
    // A duplicate delivery job for the same row is also harmless.
    const row = await rowFor(app.id, 'APPLICATION_SUBMITTED', 'SENT');
    await h.app.get(OutboxRelayService).enqueue([row.id]);
    await new Promise((r) => setTimeout(r, 500));
    expect(h.mail.sent.filter((m) => m.to === email)).toHaveLength(before);
    expect(await h.prisma.notification.count({ where: { eventId: ev.id } })).toBe(1);
  });

  it('should skip optional emails after opt-out but still send mandatory ones', async () => {
    const citizen = await signUpCitizen(h);
    await request(h.http())
      .put(`${api}/account/notification-preferences`)
      .set(bearer(citizen.session))
      .send({ emailOptional: false })
      .expect(200);
    const audit = await h.prisma.auditLog.findFirstOrThrow({
      where: { entityId: citizen.session.user.id, action: 'USER_NOTIFICATION_PREFERENCES_UPDATED' },
    });
    expect(audit).toMatchObject({
      actorId: citizen.session.user.id,
      before: { emailOptional: true },
      after: { emailOptional: false },
    });
    const { app } = await submitted(citizen);
    await rowFor(app.id, 'APPLICATION_SUBMITTED', 'SKIPPED');
    expect(h.mail.last(citizen.email, 'APPLICATION_SUBMITTED')).toBeUndefined();
    await event('APPLICATION_REFERRED', app.id);
    await rowFor(app.id, 'APPLICATION_REFERRED', 'SENT');
    expect(h.mail.last(citizen.email, 'APPLICATION_REFERRED')).toBeDefined();
    // The skipped message still appears in the app.
    const page = (
      await request(h.http()).get(`${api}/notifications`).set(bearer(citizen.session)).expect(200)
    ).body as NotificationPage;
    expect(page.items.map((i) => [i.template, i.emailStatus])).toEqual(
      expect.arrayContaining([
        ['APPLICATION_SUBMITTED', 'SKIPPED'],
        ['APPLICATION_REFERRED', 'SENT'],
      ]),
    );
  });

  it('should retry a temporary failure and then deliver', async () => {
    const { email, app } = await submitted();
    await rowFor(app.id, 'APPLICATION_SUBMITTED', 'SENT');
    let failures = 0;
    h.mail.failWith = (m) =>
      m.to === email && m.template === 'APPLICATION_REFERRED' && failures++ < 1
        ? new NotificationDeliveryError(m.template, 'ETIMEDOUT', undefined)
        : undefined;
    await event('APPLICATION_REFERRED', app.id);
    const row = await rowFor(app.id, 'APPLICATION_REFERRED', 'SENT');
    expect(row.attempts).toBe(2);
    expect(row.lastError).toBeNull();
  });

  it('should dead-letter after the last attempt, and at once on a permanent failure', async () => {
    const { email, app } = await submitted();
    await rowFor(app.id, 'APPLICATION_SUBMITTED', 'SENT');
    h.mail.failWith = (m) => {
      if (m.to !== email) return undefined;
      if (m.template === 'APPLICATION_REFERRED')
        return new NotificationDeliveryError(m.template, 'ECONNREFUSED', undefined);
      if (m.template === 'APPLICATION_REJECTED')
        return new NotificationDeliveryError(m.template, 'EENVELOPE', 550);
      return undefined;
    };
    await event('APPLICATION_REFERRED', app.id);
    await event('APPLICATION_REJECTED', app.id);
    const transient = await rowFor(app.id, 'APPLICATION_REFERRED', 'DEAD');
    expect(transient).toMatchObject({ attempts: 3, lastError: 'ECONNREFUSED' }); // NOTIFY_ATTEMPTS=3
    const permanent = await rowFor(app.id, 'APPLICATION_REJECTED', 'DEAD');
    expect(permanent).toMatchObject({ attempts: 1, lastError: 'EENVELOPE 550' });
    const dead = h.app.get<Queue>(getQueueToken(NOTIFY_DEAD_QUEUE));
    const jobs = await until(async () => {
      const all = await dead.getJobs(['waiting', 'delayed', 'prioritized']);
      const ids = all.map((j) => (j.data as { notificationId: string }).notificationId);
      return ids.includes(transient.id) && ids.includes(permanent.id) ? all : null;
    });
    expect(JSON.stringify(jobs.map((j): unknown => j.data))).not.toContain(email);
  });

  it('should list, count and mark the caller’s own notifications only', async () => {
    const a = await submitted();
    const other = await signUpCitizen(h);
    const row = await rowFor(a.app.id, 'APPLICATION_SUBMITTED', 'SENT');
    const count = async (s: AuthSession) =>
      (
        (
          await request(h.http())
            .get(`${api}/notifications/unread-count`)
            .set(bearer(s))
            .expect(200)
        ).body as { unread: number }
      ).unread;
    expect(await count(a.session)).toBe(1);
    const page = (
      await request(h.http()).get(`${api}/notifications`).set(bearer(a.session)).expect(200)
    ).body as NotificationPage;
    // Direct sends (verification code) are logged but not listed.
    expect(page.items.map((i) => i.template)).toEqual(['APPLICATION_SUBMITTED']);
    expect(page.items[0]).toMatchObject({
      link: `/citizen/applications/${a.app.id}`,
      readAt: null,
    });
    expect(
      await h.prisma.notification.count({
        where: { userId: a.session.user.id, template: 'VERIFY_EMAIL_CODE', status: 'SENT' },
      }),
    ).toBe(1);
    await request(h.http())
      .post(`${api}/notifications/${row.id}/read`)
      .set(bearer(other.session))
      .expect(404);
    await request(h.http())
      .post(`${api}/notifications/${row.id}/read`)
      .set(bearer(a.session))
      .expect(204);
    expect(await count(a.session)).toBe(0);
    await event('APPLICATION_REFERRED', a.app.id);
    await rowFor(a.app.id, 'APPLICATION_REFERRED');
    expect(await count(a.session)).toBe(1);
    await request(h.http())
      .post(`${api}/notifications/read-all`)
      .set(bearer(a.session))
      .expect(204);
    expect(await count(a.session)).toBe(0);
  });

  it('should tell the department supervisors once when the SLA is missed', async () => {
    const sup = await signUpStaff(h, 'SUPERVISOR', 'ADDRESS');
    const { app } = await submitted();
    await h.prisma.application.update({
      where: { id: app.id },
      data: {
        status: 'QUEUED',
        queuedAt: new Date(Date.now() - 9 * 86_400_000),
        slaDueAt: new Date(Date.now() - 1000),
      },
    });
    const review = h.app.get(ReviewService);
    expect(await review.detectSlaBreaches()).toBeGreaterThanOrEqual(1);
    expect(await review.detectSlaBreaches()).toBe(0);
    const row = await until(() =>
      h.prisma.notification.findFirst({
        where: { userId: sup.session.user.id, template: 'SLA_BREACHED', status: 'SENT' },
      }),
    );
    expect(row.vars).toMatchObject({ referenceNo: app.referenceNo });
    expect(h.mail.last(sup.email, 'SLA_BREACHED')!.vars['link']).toBe(
      `http://localhost:5173/officer/review/${app.id}`,
    );
    expect(
      await h.prisma.auditLog.count({
        where: { entityId: app.id, action: 'APPLICATION_SLA_BREACHED' },
      }),
    ).toBe(1);
  });
});
