import { randomUUID } from 'node:crypto';
import {
  type ApplicationDetail,
  type AuthSession,
  type CertificateSummary,
  type PaymentDto,
  type RefundDto,
  type Role,
  type StaffApplication,
} from '@govserve/shared';
import { type OpenAPIObject } from '@nestjs/swagger';
import request from 'supertest';
import { listRoutes, type RouteInfo } from '../../scripts/route-inventory';
import { buildOpenApiDocument } from '../../src/swagger';
import { MATRIX, type Resource, type Rule } from './authz-matrix';
import { ANSWERS, DOCS } from './fixtures';
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
const METRICS_TOKEN = 'authz-matrix-metrics-token-0123456789';
type Caller = { label: string; role: Role; session: AuthSession };
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Placeholder values for non-resource path parameters (role probes never hit a real record). */
const PLACEHOLDER: Record<string, string> = {
  code: 'NO_SUCH_SERVICE',
  certificateNo: 'C-2000-000000',
  receiptNo: 'R-2000-000000',
  referenceNo: 'GS-2000-000000',
  ref: 'no-such-checkout',
  outcome: 'success',
  dataset: 'collections',
  date: '2030-01-01',
  key: 'no.such.setting',
};

const errorCode = (res: request.Response) =>
  ((res.body as { error?: { code?: string } } | undefined)?.error?.code ?? '').toString();

/** Statuses that show the guard let the caller through (anything but an auth refusal). */
const passedGuard = (status: number) => status !== 401 && status !== 403;

describe('Authorization matrix: every endpoint × every role (integration, SPEC §2.1)', () => {
  let h: Harness;
  let routes: RouteInfo[];
  let doc: OpenAPIObject;

  // Scope A: the records under test. Scope B: callers who must not reach them.
  let citizenA: AuthSession;
  let citizenB: AuthSession;
  let officerA: AuthSession;
  let supervisorA: AuthSession;
  let officerB: AuthSession;
  let supervisorB: AuthSession;
  let admin: AuthSession;
  let addressDeptId: string;

  const ids = {} as Record<Resource | 'receipt', string> & {
    applicationRef: string;
    issuedApplication: string;
    issuedRef: string;
    certificateNo: string;
    receiptNo: string;
  };

  const call = (method: string, path: string, session?: AuthSession, body?: unknown) => {
    let req = request(h.http())[method.toLowerCase() as Method](path);
    if (session) req = req.set(bearer(session));
    // Checked before the handler, so every probe carries one.
    if (method === 'POST') req = req.set('Idempotency-Key', randomUUID());
    return body === undefined ? req : req.send(body as object);
  };
  const post = (who: AuthSession, path: string, body: object = {}) =>
    call('POST', `${api}${path}`, who, body);

  beforeAll(async () => {
    h = await startHarness({ env: { METRICS_TOKEN } });
    routes = listRoutes(h.app);
    doc = buildOpenApiDocument(h.app);

    citizenA = (await signUpCitizen(h)).session;
    citizenB = (await signUpCitizen(h)).session;
    officerA = (await signUpStaff(h, 'OFFICER', 'ADDRESS')).session;
    supervisorA = (await signUpStaff(h, 'SUPERVISOR', 'ADDRESS')).session;
    officerB = (await signUpStaff(h, 'OFFICER', 'POLICE')).session;
    supervisorB = (await signUpStaff(h, 'SUPERVISOR', 'POLICE')).session;
    admin = (await signUpStaff(h, 'ADMIN', null)).session;
    addressDeptId = (await h.prisma.department.findUniqueOrThrow({ where: { code: 'ADDRESS' } }))
      .id;

    // Application 1: overpaid, confirmed (receipt), refund requested, approved (certificate).
    const first = await submittedApplication(citizenA);
    const overpaid = (
      await post(citizenA, `/applications/${first.id}/payments`, {
        channel: 'MOBILE_MONEY',
        provider: 'EVC_PLUS',
        reference: `AZ${Date.now()}1`,
        amountCents: (BigInt(first.feeAssessment!.totalCents) + 500n).toString(),
        paidAt: '2026-10-13',
      }).expect(201)
    ).body as PaymentDto;
    await post(officerA, `/staff/payments/${overpaid.id}/confirm`).expect(200);
    const refund = (
      await post(officerA, `/staff/payments/${overpaid.id}/refunds`, {
        reason: 'OVERPAYMENT',
        amountCents: '500',
      }).expect(201)
    ).body as RefundDto;
    let staffView = (
      await call('GET', `${api}/review/applications/${first.id}`, officerA).expect(200)
    ).body as StaffApplication;
    staffView = (
      await post(officerA, `/review/applications/${first.id}/claim`, {
        version: staffView.version,
      }).expect(200)
    ).body as StaffApplication;
    await post(officerA, `/review/applications/${first.id}/approve`, {
      version: staffView.version,
    }).expect(200);
    const certificate = (
      (await call('GET', `${api}/certificates`, citizenA).expect(200)).body as CertificateSummary[]
    )[0]!;
    const receipt = await h.prisma.receipt.findFirstOrThrow({ where: { paymentId: overpaid.id } });

    // Application 2: submitted, with a document and a payment waiting for verification.
    const second = await submittedApplication(citizenA);
    const pending = (
      await post(citizenA, `/applications/${second.id}/payments`, {
        channel: 'MOBILE_MONEY',
        provider: 'EVC_PLUS',
        reference: `AZ${Date.now()}2`,
        amountCents: second.feeAssessment!.totalCents,
        paidAt: '2026-10-13',
      }).expect(201)
    ).body as PaymentDto;
    const document = await h.prisma.document.findFirstOrThrow({
      where: { applicationId: second.id },
    });
    const { applicantId } = await h.prisma.application.findUniqueOrThrow({
      where: { id: second.id },
      select: { applicantId: true },
    });
    const notification = await h.owner.notification.create({
      data: { userId: applicantId, template: 'APPLICATION_SUBMITTED', vars: {} },
    });

    Object.assign(ids, {
      application: second.id,
      applicationRef: second.referenceNo,
      issuedApplication: first.id,
      issuedRef: first.referenceNo,
      document: document.id,
      payment: pending.id,
      receipt: overpaid.id,
      receiptNo: receipt.receiptNo,
      certificate: certificate.id,
      certificateNo: certificate.certificateNo,
      refund: refund.id,
      notification: notification.id,
      user: applicantId,
    });
  }, 180_000);

  afterAll(async () => {
    await h?.close();
  });

  /** A proof-of-address application of the given citizen, filled in, documented and submitted. */
  async function submittedApplication(citizen: AuthSession): Promise<ApplicationDetail> {
    const app = (
      await post(citizen, '/applications', { serviceCode: 'PROOF_OF_ADDRESS' }).expect(201)
    ).body as ApplicationDetail;
    await call('PATCH', `${api}/applications/${app.id}`, citizen, {
      formData: ANSWERS.PROOF_OF_ADDRESS,
    }).expect(200);
    for (const [docType] of DOCS.PROOF_OF_ADDRESS) {
      const u = await upload(h, citizen, app.id, docType, FILES.pdf());
      await waitForDocument(h, u.ticket.document.id, 'CLEAN');
    }
    return (await post(citizen, `/applications/${app.id}/submit`).expect(200))
      .body as ApplicationDetail;
  }

  const rule = (r: RouteInfo): Rule => MATRIX[`${r.method} ${r.path}`]!;
  const fill = (path: string, value: (param: string) => string) =>
    path.replace(/:([A-Za-z]+)/g, (_, p: string) => value(p));

  /** Bodies where the generated example does not pass validation. */
  const VALID_BODY: Record<string, object> = {
    'POST /api/v1/review/applications/:id/reject': {
      version: 1,
      reasonCode: 'NOT_ELIGIBLE',
      note: 'The applicant does not meet the requirements.',
    },
  };

  /** The OpenAPI request example for an operation, so validation passes and scoping decides. */
  function exampleBody(r: RouteInfo): unknown {
    const override = VALID_BODY[`${r.method} ${r.path}`];
    if (override) return override;
    const openApiPath = r.path.replace(/:([A-Za-z]+)/g, '{$1}');
    const op = (doc.paths[openApiPath] as Record<string, { requestBody?: unknown }> | undefined)?.[
      r.method.toLowerCase()
    ] as { requestBody?: { content?: Record<string, { example?: unknown }> } } | undefined;
    return op?.requestBody?.content?.['application/json']?.example;
  }

  /** Callers outside scope A that the endpoint's roles admit (admins are system-wide by design). */
  function outsiders(r: RouteInfo): Caller[] {
    const allow = rule(r).allow;
    if (!Array.isArray(allow)) return [];
    const all: Caller[] = [
      { label: 'citizen B', role: 'CITIZEN', session: citizenB },
      { label: 'officer B (Police)', role: 'OFFICER', session: officerB },
      { label: 'supervisor B (Police)', role: 'SUPERVISOR', session: supervisorB },
    ];
    return all.filter((c) => allow.includes(c.role));
  }

  /** Every row of scope A, to prove that refused calls changed nothing. */
  async function snapshotA() {
    const appIds = [ids.application, ids.issuedApplication];
    const [applications, payments, documents, certificates, refunds, notifications] =
      await Promise.all([
        h.owner.application.findMany({ where: { id: { in: appIds } }, orderBy: { id: 'asc' } }),
        h.owner.payment.findMany({
          where: { applicationId: { in: appIds } },
          orderBy: { id: 'asc' },
        }),
        h.owner.document.findMany({
          where: { applicationId: { in: appIds } },
          orderBy: { id: 'asc' },
        }),
        h.owner.certificate.findMany({ where: { applicationId: { in: appIds } } }),
        h.owner.refund.findMany({ where: { id: ids.refund } }),
        h.owner.notification.findMany({ where: { id: ids.notification } }),
      ]);
    return JSON.stringify(
      { applications, payments, documents, certificates, refunds, notifications },
      (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
    );
  }

  it('should list every live endpoint when the app starts', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  it('should refuse with 403 or 404 and change nothing when outsiders call a scoped record', async () => {
    const before = await snapshotA();
    const failures: string[] = [];
    const resourceValue = (resource: Resource) => (param: string) => {
      if (param === 'id') return ids[resource];
      if (param === 'referenceNo') return ids.applicationRef;
      return PLACEHOLDER[param] ?? 'x';
    };
    for (const r of routes) {
      const scope = rule(r).scope;
      if (scope?.kind !== 'resource') continue;
      // Receipts and certificates exist only on the issued application.
      const resource: Resource | 'receipt' = r.path.endsWith('/receipt.pdf')
        ? 'receipt'
        : scope.resource;
      const path = fill(r.path, (p) =>
        p === 'id' && resource === 'receipt' ? ids.receipt : resourceValue(scope.resource)(p),
      );
      for (const who of outsiders(r)) {
        const res = await call(r.method, path, who.session, exampleBody(r));
        if (res.status !== 403 && res.status !== 404)
          failures.push(`${r.method} ${r.path} as ${who.label}: ${res.status} ${errorCode(res)}`);
      }
    }
    expect(failures).toEqual([]);
    expect(await snapshotA()).toBe(before);
  }, 120_000);

  it('should omit the records when another owner or department lists them', async () => {
    const secrets = [
      ids.application,
      ids.applicationRef,
      ids.issuedApplication,
      ids.issuedRef,
      ids.payment,
      ids.receipt,
      ids.receiptNo,
      ids.certificate,
      ids.certificateNo,
      ids.refund,
      ids.notification,
      ids.document,
    ];
    const LIST_BODY: Record<string, (ref: string) => object> = {
      '/api/v1/search/applications': (ref) => ({ referenceNo: ref }),
      '/api/v1/search/payments': (ref) => ({ referenceNo: ref }),
      '/api/v1/search/applications.csv': (ref) => ({ referenceNo: ref }),
      '/api/v1/search/payments.csv': (ref) => ({ referenceNo: ref }),
    };
    const failures: string[] = [];
    for (const r of routes) {
      if (rule(r).scope?.kind !== 'list') continue;
      for (const who of outsiders(r)) {
        for (const ref of [ids.applicationRef, ids.issuedRef]) {
          const res = await call(r.method, r.path, who.session, LIST_BODY[r.path]?.(ref));
          if (res.status !== 200) {
            failures.push(`${r.method} ${r.path} as ${who.label}: ${res.status}`);
            continue;
          }
          const leaked = secrets.filter((s) => res.text.includes(s));
          if (leaked.length > 0)
            failures.push(`${r.method} ${r.path} as ${who.label} shows ${leaked.join(', ')}`);
        }
      }
    }
    expect(failures).toEqual([]);
    // The same lists do show the records to their owner and department (the probe is not vacuous).
    const own = await call('GET', `${api}/applications`, citizenA).expect(200);
    expect(own.text).toContain(ids.application);
    const dept = await post(officerA, '/search/applications', { referenceNo: ids.applicationRef });
    expect(dept.text).toContain(ids.application);
  }, 120_000);

  it('should keep a supervisor to their department when a report asks for another', async () => {
    const failures: string[] = [];
    const stable = (text: string) => text.replace(/"(generatedAt|asOf)":"[^"]*"/g, '');
    for (const r of routes) {
      if (rule(r).scope?.kind !== 'report') continue;
      const path = fill(r.path, (p) => PLACEHOLDER[p] ?? 'x');
      const own = await call('GET', path, supervisorB).expect(200);
      const asked = await call('GET', `${path}?departmentId=${addressDeptId}`, supervisorB);
      if (asked.status !== 200 || stable(asked.text) !== stable(own.text))
        failures.push(`${r.method} ${r.path}: departmentId changed the answer (${asked.status})`);
    }
    expect(failures).toEqual([]);
  }, 60_000);

  it('should admit only the matrix roles when every role calls every endpoint', async () => {
    const callers: Caller[] = [
      { label: 'citizen', role: 'CITIZEN', session: citizenA },
      { label: 'officer', role: 'OFFICER', session: officerA },
      { label: 'supervisor', role: 'SUPERVISOR', session: supervisorA },
      { label: 'admin', role: 'ADMIN', session: admin },
    ];
    const failures: string[] = [];
    for (const r of routes) {
      const { allow, note } = rule(r);
      const path = fill(r.path, (p) => (p === 'id' ? randomUUID() : (PLACEHOLDER[p] ?? 'x')));
      if (allow === 'public') {
        const res = await call(r.method, path, undefined, {});
        const ok = res.status !== 403 && (res.status !== 401 || note?.startsWith('401'));
        if (!ok) failures.push(`${r.method} ${r.path} anonymous: ${res.status}`);
        continue;
      }
      if (allow === 'token') {
        const res = await call(r.method, path, undefined, {});
        if (res.status !== 400 && res.status !== 401)
          failures.push(`${r.method} ${r.path} without its credential: ${res.status}`);
        continue;
      }
      const anon = await call(r.method, path, undefined, {});
      if (anon.status !== 401) failures.push(`${r.method} ${r.path} anonymous: ${anon.status}`);
      for (const who of callers) {
        const res = await call(r.method, path, who.session, {});
        const allowed = allow.includes(who.role);
        if (allowed && !passedGuard(res.status))
          failures.push(`${r.method} ${r.path} as ${who.label}: ${res.status}, expected access`);
        if (!allowed && res.status !== 403)
          failures.push(`${r.method} ${r.path} as ${who.label}: ${res.status}, expected 403`);
      }
    }
    expect(failures).toEqual([]);
  }, 180_000);

  it('should refuse metrics when the bearer token is missing', async () => {
    await call('GET', '/metrics').expect(401);
    await call('GET', '/metrics').set('Authorization', `Bearer ${METRICS_TOKEN}`).expect(200);
  });
});
