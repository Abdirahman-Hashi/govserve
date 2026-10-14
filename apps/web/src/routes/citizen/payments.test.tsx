import { bytesToBase64Url, canonicalize } from '@govserve/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSession } from '../../auth/session-store';
import { t } from '../../strings';
import { mockApi, NO_SESSION, sessionFor } from '../../test/fetch-mock';
import { renderRoute } from '../../test/render';
import { dollarsToCents } from './PaymentPanel';

describe('dollarsToCents (no floating point)', () => {
  it.each([
    ['19', '1900'],
    ['19.5', '1950'],
    ['19.05', '1905'],
    ['$ 0.01', '1'],
    ['0.1', '10'],
    ['1234567.89', '123456789'],
  ])('should convert %s to %s cents', (input, cents) => {
    expect(dollarsToCents(input)).toBe(cents);
  });

  it.each(['', '0', '19.001', '-5', 'abc', '1,000'])('should refuse %s', (input) => {
    expect(dollarsToCents(input)).toBeNull();
  });
});

const ID = '0199e0a8-7c1b-7d2e-9f00-00000000bbbb';
const awaiting = {
  id: ID,
  referenceNo: 'GS-2026-000042',
  serviceCode: 'POLICE_CLEARANCE',
  serviceName: 'Police clearance',
  status: 'AWAITING_PAYMENT',
  createdAt: '2026-10-13T10:00:00.000Z',
  updatedAt: '2026-10-13T10:00:00.000Z',
  submittedAt: '2026-10-13T10:00:00.000Z',
  kind: 'STANDARD',
  extraCopies: 2,
  serviceVersionId: '0199e0a8-7c1b-7d2e-9f00-1a2b3c4d5e6f',
  formSchema: {
    type: 'object',
    properties: { fullName: { type: 'string', title: 'Full name' } },
    required: [],
  },
  uiSchema: { order: ['fullName'] },
  requiredDocuments: [],
  fee: { baseCents: '1500', perCopyCents: '200' },
  feeProvisional: true,
  formData: {},
  documents: [],
  history: [],
  feeAssessment: {
    totalCents: '1900',
    lines: [{ code: 'BASE', qty: 1, unitCents: '1500', amountCents: '1500' }],
  },
  payments: [],
  paidCents: '0',
  balanceCents: '1900',
  cardPaymentsEnabled: true,
  appointments: [],
  certificate: null,
  allowedActions: ['WITHDRAW'],
  editableFields: [],
  editableDocTypes: [],
  correction: null,
};

describe('citizen payment panel', () => {
  afterEach(() => {
    clearSession();
    vi.unstubAllGlobals();
  });

  it('should send the mobile money report in exact cents', async () => {
    const { calls } = mockApi({
      'POST /api/v1/auth/refresh': () => ({ status: 200, body: sessionFor('CITIZEN') }),
      [`GET /api/v1/applications/${ID}`]: () => ({ status: 200, body: awaiting }),
      [`POST /api/v1/applications/${ID}/payments`]: () => ({
        status: 201,
        body: {
          id: '0199e0a8-7c1b-7d2e-9f00-00000000cccc',
          applicationId: ID,
          channel: 'MOBILE_MONEY',
          provider: 'EVC_PLUS',
          reference: 'TX1',
          amountCents: '1900',
          overpaidCents: '0',
          refundedCents: '0',
          paidAt: '2026-10-13T09:00:00.000Z',
          status: 'PENDING_VERIFICATION',
          rejectNote: null,
          receiptNo: null,
          createdAt: '2026-10-13T10:00:00.000Z',
        },
      }),
    });
    renderRoute(`/citizen/applications/${ID}`);
    expect(await screen.findByTestId('balance')).toHaveTextContent('$19.00');
    await userEvent.type(screen.getByLabelText(t.payments.reference), 'TX 8839201');
    await userEvent.click(screen.getByRole('button', { name: t.payments.submit }));
    expect(await screen.findByText(t.payments.submitted)).toBeInTheDocument();
    const body = calls.find((c) => c.key === `POST /api/v1/applications/${ID}/payments`)
      ?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      channel: 'MOBILE_MONEY',
      provider: 'EVC_PLUS',
      reference: 'TX 8839201',
      amountCents: '1900',
    });
  });

  it('should refuse an invalid amount before calling the API', async () => {
    const { calls } = mockApi({
      'POST /api/v1/auth/refresh': () => ({ status: 200, body: sessionFor('CITIZEN') }),
      [`GET /api/v1/applications/${ID}`]: () => ({ status: 200, body: awaiting }),
    });
    renderRoute(`/citizen/applications/${ID}`);
    const amount = await screen.findByLabelText(t.payments.amount);
    await userEvent.clear(amount);
    await userEvent.type(amount, '19.005');
    await userEvent.click(screen.getByRole('button', { name: t.payments.submit }));
    expect(screen.getByText(t.payments.invalidAmount)).toBeInTheDocument();
    expect(calls.some((c) => c.key.endsWith('/payments'))).toBe(false);
  });

  it.each([
    ['offer', true, 4],
    ['hide', false, 3],
  ])('should %s the card option when card payments enabled is %s', async (_, enabled, options) => {
    mockApi({
      'POST /api/v1/auth/refresh': () => ({ status: 200, body: sessionFor('CITIZEN') }),
      [`GET /api/v1/applications/${ID}`]: () => ({
        status: 200,
        body: { ...awaiting, cardPaymentsEnabled: enabled },
      }),
    });
    renderRoute(`/citizen/applications/${ID}`);
    await screen.findByTestId('balance');
    expect(screen.getAllByRole('radio')).toHaveLength(options);
    const card = screen.queryByRole('radio', { name: t.payments.channels.CARD });
    expect(card !== null).toBe(enabled);
  });
});

describe('public receipt verification', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function signedReceipt() {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const payload = {
      t: 'RCPT',
      no: 'R-2026-000007',
      svc: 'Police clearance',
      iss: '2026-10-13T12:00:00.000Z',
      h: 'Amina H***',
      amt: '1900',
      kid: 'k1',
    } as const;
    const sig = new Uint8Array(
      await crypto.subtle.sign(
        { name: 'Ed25519' },
        pair.privateKey,
        new TextEncoder().encode(canonicalize(payload)),
      ),
    );
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    return { payload, sig: bytesToBase64Url(sig), pub: bytesToBase64Url(pub) };
  }

  function serve(payload: object, pub: string, status = 'VALID') {
    mockApi({
      'POST /api/v1/auth/refresh': NO_SESSION,
      'GET /api/v1/verify/r/R-2026-000007': () => ({
        status: 200,
        body: {
          receiptNo: 'R-2026-000007',
          serviceName: 'Police clearance',
          amountCents: '1900',
          issuedAt: '2026-10-13T12:00:00.000Z',
          status,
          payload,
        },
      }),
      'GET /api/v1/verify/keys': () => ({
        status: 200,
        body: { keys: [{ kid: 'k1', algorithm: 'Ed25519', publicKey: pub, status: 'ACTIVE' }] },
      }),
    });
  }

  it('should confirm a genuine receipt and show only non-personal details', async () => {
    const { payload, sig, pub } = await signedReceipt();
    serve(payload, pub);
    renderRoute(`/verify/r/R-2026-000007#sig=${sig}`);
    expect(await screen.findByText(t.verifyReceipt.signatureOk)).toBeInTheDocument();
    expect(screen.getByTestId('receipt-status')).toHaveTextContent(
      t.verifyReceipt.status['VALID']!,
    );
    expect(screen.getByText('$19.00')).toBeInTheDocument();
    expect(screen.getByText('Amina H***')).toBeInTheDocument();
  });

  it('should flag a receipt whose details were altered', async () => {
    const { payload, sig, pub } = await signedReceipt();
    serve({ ...payload, amt: '190000' }, pub);
    renderRoute(`/verify/r/R-2026-000007#sig=${sig}`);
    expect(await screen.findByText(t.verifyReceipt.signatureBad)).toBeInTheDocument();
    expect(screen.getByTestId('receipt-status')).toHaveTextContent('✕');
  });

  it('should explain when the link carries no signature', async () => {
    const { payload, pub } = await signedReceipt();
    serve(payload, pub, 'REFUNDED');
    renderRoute('/verify/r/R-2026-000007');
    expect(await screen.findByText(t.verifyReceipt.signatureMissing)).toBeInTheDocument();
    expect(screen.getByTestId('receipt-status')).toHaveTextContent(
      t.verifyReceipt.status['REFUNDED']!,
    );
  });
});
