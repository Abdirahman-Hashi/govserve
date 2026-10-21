// GovServe load test (NFR-006): 200 users browsing, 50 submitting and 20 paying at the same time.
// Run with perf/k6/run.sh against the local stack; see docs/RUNBOOK.md §Load test.
import crypto from 'k6/crypto';
import { check, fail, sleep } from 'k6';
import http from 'k6/http';

const BASE = __ENV.BASE_URL || 'http://govserve.localhost';
const API = `${BASE}/api/v1`;
const PASSWORD = __ENV.LOADTEST_PASSWORD;
const DURATION = __ENV.DURATION || '5m';
// One account per virtual user: k6 numbers VUs across all scenarios (1…270).
const ACCOUNTS = 270;
const SERVICES = ['PROOF_OF_ADDRESS', 'POLICE_CLEARANCE', 'BIRTH_CERTIFICATE'];

export const options = {
  setupTimeout: '15m',
  hosts: { 'govserve.localhost': '127.0.0.1' },
  discardResponseBodies: false,
  scenarios: {
    browsing: { executor: 'constant-vus', vus: 200, duration: DURATION, exec: 'browse' },
    submitting: { executor: 'constant-vus', vus: 50, duration: DURATION, exec: 'submit' },
    paying: { executor: 'constant-vus', vus: 20, duration: DURATION, exec: 'pay' },
  },
  // NFR-006: reads p95 ≤ 500 ms, writes p95 ≤ 1 s. Uploads to storage are outside the API.
  thresholds: {
    'http_req_duration{kind:read}': ['p(95)<500'],
    'http_req_duration{kind:write}': ['p(95)<1000'],
    'checks{scenario:browsing}': ['rate>0.99'],
    'checks{scenario:submitting}': ['rate>0.95'],
    'checks{scenario:paying}': ['rate>0.95'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'max', 'count'],
};

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
const PDF = `%PDF-1.7\n${'a'.repeat(40 * 1024)}`;
const PDF_SHA256 = crypto.sha256(PDF, 'hex');

/** Every request is named by its route, so the summary reports p95 per endpoint. */
function req(method, name, url, body, token, extra = {}) {
  const params = {
    headers: { 'Content-Type': 'application/json', ...(extra.headers || {}) },
    tags: { name, kind: method === 'GET' ? 'read' : 'write' },
    redirects: extra.redirects ?? 10,
  };
  if (token) params.headers.Authorization = `Bearer ${token}`;
  return http.request(method, url, body === undefined ? null : JSON.stringify(body), params);
}

const think = (min, max) => sleep(min + Math.random() * (max - min));

/**
 * Makes sure the load-test citizens exist (one per virtual user). They normally come from the loadtest-citizens CLI;
 * when MAILPIT_URL is set (local stack), missing ones are registered here through the API, reading
 * the email code from Mailpit. Runs once, before the measured scenarios start.
 */
export function setup() {
  const mailpit = __ENV.MAILPIT_URL;
  let registered = 0;
  for (let n = 1; n <= ACCOUNTS; n += 1) {
    const email = `loadtest-${String(n).padStart(3, '0')}@govserve.test`;
    const login = http.post(`${API}/auth/login`, JSON.stringify({ email, password: PASSWORD }), {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'setup' },
    });
    if (login.status === 200) continue;
    if (!mailpit) fail(`${email} cannot sign in (${login.status}); run the loadtest-citizens CLI`);
    const body = {
      fullName: `Load Test ${n}`,
      email,
      phone: '+252 61 555 0000',
      password: PASSWORD,
    };
    const reg = http.post(`${API}/auth/register`, JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'setup' },
    });
    if (reg.status !== 202) fail(`register ${email}: ${reg.status}`);
    let code = null;
    for (let i = 0; i < 20 && !code; i += 1) {
      sleep(0.5);
      const found = http.get(
        `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=1`,
        {
          tags: { name: 'setup' },
        },
      );
      const id = found.status === 200 && (found.json('messages') || [])[0]?.ID;
      if (id)
        code = /\b(\d{6})\b/.exec(http.get(`${mailpit}/api/v1/message/${id}`).json('Text'))?.[1];
    }
    if (!code) fail(`no verification code for ${email}`);
    const ok = http.post(`${API}/auth/verify-email`, JSON.stringify({ email, code }), {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'setup' },
    });
    if (ok.status !== 200)
      fail(`verify ${email}: ${ok.status} (an older run used another password?)`);
    registered += 1;
  }
  console.log(`load-test citizens ready (${registered} registered now)`);
}

// ---------------------------------------------------------------------------------------------
// Browsing: the public pages a citizen reads before applying.
export function browse() {
  const page = http.get(`${BASE}/`, { tags: { name: 'GET / (web app)', kind: 'read' } });
  check(page, { 'web app 200': (r) => r.status === 200 });
  const list = req('GET', 'GET /catalogue/services', `${API}/catalogue/services`);
  check(list, { 'catalogue 200': (r) => r.status === 200 });
  think(1, 3);
  const code = SERVICES[Math.floor(Math.random() * SERVICES.length)];
  const svc = req('GET', 'GET /catalogue/services/:code', `${API}/catalogue/services/${code}`);
  check(svc, { 'service 200': (r) => r.status === 200 });
  think(2, 5);
  if (Math.random() < 0.2) {
    const keys = req('GET', 'GET /verify/keys', `${API}/verify/keys`);
    check(keys, { 'verify keys 200': (r) => r.status === 200 });
    const cert = req(
      'GET',
      'GET /verify/c/:no',
      `${API}/verify/c/ADR-2026-${String(Math.floor(Math.random() * 999999)).padStart(6, '0')}`,
    );
    check(cert, { 'verify answers': (r) => r.status === 200 || r.status === 404 });
  }
  think(1, 3);
}

// ---------------------------------------------------------------------------------------------
// Citizens with an account: each virtual user signs in as its own load-test citizen.
const sessions = {};

function citizenToken() {
  const n = __VU;
  const cached = sessions[n];
  if (cached && cached.until > Date.now()) return cached.token;
  const email = `loadtest-${String(n).padStart(3, '0')}@govserve.test`;
  const res = req('POST', 'POST /auth/login', `${API}/auth/login`, { email, password: PASSWORD });
  if (!check(res, { 'login 200': (r) => r.status === 200 && r.json('status') === 'OK' })) {
    sleep(5); // do not hammer the API when an account is broken
    fail(`login failed for ${email}: ${res.status}`);
  }
  sessions[n] = { token: res.json('accessToken'), until: Date.now() + 10 * 60_000 };
  return sessions[n].token;
}

/** Closes any application left open by an earlier, interrupted iteration (one open per service). */
function withdrawOpen(token) {
  const mine = req('GET', 'GET /applications', `${API}/applications`, undefined, token);
  if (mine.status !== 200) return;
  for (const app of mine.json('items') || []) {
    if (app.serviceCode !== 'PROOF_OF_ADDRESS') continue;
    if (app.status === 'DRAFT')
      req('DELETE', 'DELETE /applications/:id', `${API}/applications/${app.id}`, undefined, token);
    else if (!['WITHDRAWN', 'ISSUED', 'REJECTED', 'REFERRED', 'ABANDONED'].includes(app.status))
      req(
        'POST',
        'POST /applications/:id/withdraw',
        `${API}/applications/${app.id}/withdraw`,
        {},
        token,
      );
  }
}

/** Draft → two autosaves → two uploads (scanned) → submit. Returns the submitted application. */
function applyForProofOfAddress(token) {
  withdrawOpen(token);
  const created = req(
    'POST',
    'POST /applications',
    `${API}/applications`,
    { serviceCode: 'PROOF_OF_ADDRESS' },
    token,
  );
  if (!check(created, { 'draft created': (r) => r.status === 201 })) return null;
  const id = created.json('id');
  think(2, 4);
  const half = { fullName: ANSWERS.fullName, dateOfBirth: ANSWERS.dateOfBirth };
  req('PATCH', 'PATCH /applications/:id', `${API}/applications/${id}`, { formData: half }, token);
  think(3, 6);
  const saved = req(
    'PATCH',
    'PATCH /applications/:id',
    `${API}/applications/${id}`,
    { formData: ANSWERS },
    token,
  );
  check(saved, { 'autosave 200': (r) => r.status === 200 });

  for (const docType of ['NATIONAL_ID_OR_PASSPORT', 'UTILITY_BILL']) {
    const ticket = req(
      'POST',
      'POST /applications/:id/documents',
      `${API}/applications/${id}/documents`,
      {
        docType,
        fileName: 'scan.pdf',
        mime: 'application/pdf',
        sizeBytes: PDF.length,
        sha256: PDF_SHA256,
      },
      token,
    );
    if (!check(ticket, { 'upload ticket 201': (r) => r.status === 201 })) return null;
    const put = http.put(ticket.json('uploadUrl'), PDF, {
      headers: ticket.json('headers'),
      tags: { name: 'PUT object store (pre-signed)', kind: 'storage' },
    });
    check(put, { 'stored 200': (r) => r.status === 200 });
    const done = req(
      'POST',
      'POST /documents/:id/complete',
      `${API}/documents/${ticket.json('document.id')}/complete`,
      {},
      token,
    );
    check(done, { 'upload confirmed': (r) => r.status === 200 });
    think(1, 2);
  }

  // The virus scan runs in the background; the wizard polls the application until it is clean.
  let clean = false;
  for (let i = 0; i < 30 && !clean; i += 1) {
    sleep(1);
    const view = req('GET', 'GET /applications/:id', `${API}/applications/${id}`, undefined, token);
    clean =
      view.status === 200 &&
      (view.json('documents') || []).filter((d) => d.status === 'CLEAN').length >= 2;
  }
  check(clean, { 'scanned clean within 30 s': (c) => c });
  if (!clean) return null;
  think(2, 4);
  const submitted = req(
    'POST',
    'POST /applications/:id/submit',
    `${API}/applications/${id}/submit`,
    {},
    token,
  );
  if (!check(submitted, { 'submitted 200': (r) => r.status === 200 })) return null;
  return submitted.json();
}

export function submit() {
  const token = citizenToken();
  const app = applyForProofOfAddress(token);
  think(3, 6);
  if (app) {
    const status = req(
      'GET',
      'GET /applications/:id',
      `${API}/applications/${app.id}`,
      undefined,
      token,
    );
    check(status, { 'status page 200': (r) => r.status === 200 });
    req('GET', 'GET /applications', `${API}/applications`, undefined, token);
    req(
      'GET',
      'GET /notifications/unread-count',
      `${API}/notifications/unread-count`,
      undefined,
      token,
    );
    const out = req(
      'POST',
      'POST /applications/:id/withdraw',
      `${API}/applications/${app.id}/withdraw`,
      {},
      token,
    );
    check(out, { 'withdrawn 200': (r) => r.status === 200 });
  }
  think(3, 6);
}

// ---------------------------------------------------------------------------------------------
// Paying: half by mobile money evidence, half by card through the mock gateway (signed webhook).
export function pay() {
  const token = citizenToken();
  const app = applyForProofOfAddress(token);
  if (!app) return;
  think(3, 6);
  if (__ITER % 2 === 0) {
    const paid = req(
      'POST',
      'POST /applications/:id/payments',
      `${API}/applications/${app.id}/payments`,
      {
        channel: 'MOBILE_MONEY',
        provider: 'EVC_PLUS',
        reference: `LT${__VU}x${__ITER}x${Date.now()}`,
        amountCents: app.feeAssessment.totalCents,
        paidAt: new Date().toISOString().slice(0, 10),
      },
      token,
    );
    check(paid, { 'evidence 201': (r) => r.status === 201 });
  } else {
    const key = `${__VU}-${__ITER}-${Date.now()}`;
    const start = req(
      'POST',
      'POST /applications/:id/payments/card',
      `${API}/applications/${app.id}/payments/card`,
      {},
      token,
      {
        headers: { 'Idempotency-Key': key },
      },
    );
    if (check(start, { 'checkout 201': (r) => r.status === 201 })) {
      const url = start.json('checkoutUrl').replace(/^https?:\/\/[^/]+/, BASE);
      const page = http.get(url, { tags: { name: 'GET mock checkout page', kind: 'gateway' } });
      check(page, { 'checkout page 200': (r) => r.status === 200 });
      const done = http.post(`${url}/pay`, null, {
        redirects: 0,
        tags: { name: 'POST mock checkout pay', kind: 'gateway' },
      });
      check(done, { 'gateway redirect 303': (r) => r.status === 303 });
    }
  }
  // The citizen watches the status page until the payment is recorded.
  for (let i = 0; i < 10; i += 1) {
    sleep(1);
    const view = req(
      'GET',
      'GET /applications/:id',
      `${API}/applications/${app.id}`,
      undefined,
      token,
    );
    if (view.status === 200 && (view.json('payments') || []).length > 0) break;
  }
  req('GET', 'GET /payments', `${API}/payments`, undefined, token);
  think(2, 4);
  const out = req(
    'POST',
    'POST /applications/:id/withdraw',
    `${API}/applications/${app.id}/withdraw`,
    {},
    token,
  );
  check(out, { 'withdrawn 200': (r) => r.status === 200 });
  think(2, 4);
}
