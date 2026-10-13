import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSession } from '../../auth/session-store';
import { t } from '../../strings';
import { mockApi, NO_SESSION, sessionFor } from '../../test/fetch-mock';
import { renderRoute } from '../../test/render';

const ID = '0199e0a8-7c1b-7d2e-9f00-00000000aaaa';
const CERT_ID = '0199e0a8-7c1b-7d2e-9f00-00000000cccc';
const formSchema = {
  type: 'object',
  properties: {
    fullName: { type: 'string', title: 'Full name' },
    idNumber: { type: 'string', title: 'ID number', 'x-pii': true },
    district: { type: 'string', title: 'District' },
  },
  required: [],
};
const staffApp = (overrides: object = {}) => ({
  id: ID,
  referenceNo: 'GS-2026-000042',
  kind: 'STANDARD',
  serviceCode: 'PROOF_OF_ADDRESS',
  serviceName: 'Proof of address',
  approvalMode: 'SINGLE',
  inPersonStep: 'NONE',
  status: 'IN_REVIEW',
  version: 4,
  applicantName: 'Amina Hassan',
  subjectType: 'SELF',
  relationship: 'SELF',
  assigneeId: '0199e0a8-7c1b-7d2e-9f00-000000000001',
  assigneeName: 'Hodan Ali',
  claimExpiresAt: '2026-10-15T10:00:00.000Z',
  submittedAt: '2026-10-13T10:00:00.000Z',
  slaDueAt: '2026-10-20T10:00:00.000Z',
  slaRisk: 'ON_TRACK',
  correctionRound: 0,
  chargebackFlag: false,
  formSchema,
  uiSchema: { order: ['fullName', 'idNumber', 'district'] },
  formData: { fullName: 'Amina Hassan', idNumber: '••••', district: 'Hodan' },
  maskedFields: ['idNumber'],
  requiredDocuments: [],
  documents: [],
  feeAssessment: {
    totalCents: '1000',
    lines: [{ code: 'BASE', qty: 1, unitCents: '1000', amountCents: '1000' }],
  },
  payments: [],
  paidCents: '1000',
  history: [],
  appointments: [],
  decisions: [],
  corrections: [],
  certificate: null,
  allowedActions: ['RELEASE', 'REQUEST_CORRECTION', 'REJECT', 'APPROVE'],
  approvalBlockers: [],
  ...overrides,
});

describe('officer review page', () => {
  afterEach(() => {
    clearSession();
    vi.unstubAllGlobals();
  });

  it('should show masked answers and approve with the version seen', async () => {
    let current = staffApp();
    const { calls } = mockApi({
      'POST /api/v1/auth/refresh': () => ({ status: 200, body: sessionFor('OFFICER', 'ADDRESS') }),
      [`GET /api/v1/review/applications/${ID}`]: () => ({ status: 200, body: current }),
      [`POST /api/v1/review/applications/${ID}/approve`]: () => {
        current = staffApp({
          status: 'ISSUED',
          version: 5,
          allowedActions: [],
          certificate: {
            id: CERT_ID,
            certificateNo: 'ADR-2026-000001',
            serviceName: 'Proof of address',
            holderName: 'Amina Hassan',
            issuedAt: '2026-10-13T12:00:00.000Z',
            expiresAt: '2027-04-13T12:00:00.000Z',
            status: 'VALID',
            revokeReason: null,
            isDuplicate: false,
          },
        });
        return { status: 200, body: current };
      },
    });
    renderRoute(`/officer/review/${ID}`);
    expect(await screen.findByTestId('answer-idNumber')).toHaveTextContent('••••');
    await userEvent.click(screen.getByRole('button', { name: t.review.actions['APPROVE'] }));
    const confirm = screen.getByRole('group', { name: t.review.actions['APPROVE'] });
    await userEvent.click(within(confirm).getByRole('button', { name: t.review.confirm }));
    expect(await screen.findByText('ADR-2026-000001')).toBeInTheDocument();
    expect(
      calls.find((c) => c.key === `POST /api/v1/review/applications/${ID}/approve`)?.body,
    ).toEqual({
      version: 4,
    });
  });

  it('should list approval blockers and disable approval', async () => {
    mockApi({
      'POST /api/v1/auth/refresh': () => ({ status: 200, body: sessionFor('OFFICER', 'ADDRESS') }),
      [`GET /api/v1/review/applications/${ID}`]: () => ({
        status: 200,
        body: staffApp({ approvalBlockers: ['The fee is not paid in full.'] }),
      }),
    });
    renderRoute(`/officer/review/${ID}`);
    expect(await screen.findByText('The fee is not paid in full.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.review.actions['APPROVE'] })).toBeDisabled();
  });

  it('should send flagged items when requesting corrections', async () => {
    const { calls } = mockApi({
      'POST /api/v1/auth/refresh': () => ({ status: 200, body: sessionFor('OFFICER', 'ADDRESS') }),
      [`GET /api/v1/review/applications/${ID}`]: () => ({ status: 200, body: staffApp() }),
      [`POST /api/v1/review/applications/${ID}/corrections`]: () => ({
        status: 200,
        body: staffApp({ status: 'CORRECTION_REQUESTED', version: 5, allowedActions: [] }),
      }),
    });
    renderRoute(`/officer/review/${ID}`);
    await userEvent.click(
      await screen.findByRole('button', { name: t.review.actions['REQUEST_CORRECTION'] }),
    );
    const form = screen.getByRole('form', { name: t.review.actions['REQUEST_CORRECTION'] });
    await userEvent.selectOptions(within(form).getByLabelText(t.review.form.field), 'district');
    await userEvent.type(within(form).getByLabelText(t.review.form.comment), 'Give the district');
    await userEvent.click(within(form).getByRole('button', { name: t.review.confirm }));
    expect(
      await screen.findByText(t.review.statuses['CORRECTION_REQUESTED']!, { exact: false }),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.key.endsWith('/corrections'))?.body).toEqual({
      version: 4,
      items: [{ kind: 'FIELD', target: 'district', comment: 'Give the district' }],
    });
  });
});

describe('public certificate verification', () => {
  afterEach(() => {
    clearSession();
    vi.unstubAllGlobals();
  });

  const pub = {
    certificateNo: 'ADR-2026-000001',
    serviceName: 'Proof of address',
    status: 'VALID',
    issuedAt: '2026-10-13T12:00:00.000Z',
    expiresAt: '2027-04-13T12:00:00.000Z',
    revokedAt: null,
    holderNameMasked: 'Amina H***',
    payload: {
      t: 'CERT',
      no: 'ADR-2026-000001',
      svc: 'PROOF_OF_ADDRESS',
      iss: '2026-10-13T12:00:00.000Z',
      h: 'Amina H***',
      kid: 'k1',
    },
  };

  it('should show only the masked name and check a full name', async () => {
    const { calls } = mockApi({
      'POST /api/v1/auth/refresh': NO_SESSION,
      'GET /api/v1/verify/c/ADR-2026-000001': () => ({ status: 200, body: pub }),
      'GET /api/v1/verify/keys': () => ({ status: 200, body: { keys: [] } }),
      'POST /api/v1/verify/c/ADR-2026-000001/name-check': () => ({
        status: 200,
        body: { match: false },
      }),
    });
    renderRoute('/verify/c/ADR-2026-000001');
    expect(await screen.findByTestId('certificate-status')).toHaveTextContent(
      t.verifyCertificate.status['VALID']!,
    );
    expect(screen.getByText('Amina H***')).toBeInTheDocument();
    expect(await screen.findByText(t.verifyCertificate.signatureMissing)).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText(t.verifyCertificate.nameCheck.label),
      'Amina Hassan',
    );
    await userEvent.click(
      screen.getByRole('button', { name: t.verifyCertificate.nameCheck.submit }),
    );
    expect(await screen.findByText(t.verifyCertificate.nameCheck.noMatch)).toBeInTheDocument();
    expect(calls.find((c) => c.key.endsWith('/name-check'))?.body).toEqual({
      name: 'Amina Hassan',
    });
  });
});
