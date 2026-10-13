import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSession } from '../../auth/session-store';
import { t } from '../../strings';
import { mockApi, sessionFor } from '../../test/fetch-mock';
import { renderRoute } from '../../test/render';

const PID = '0199e0a8-7c1b-7d2e-9f00-00000000dddd';
const staffPayment = (status: string, overrides: object = {}) => ({
  id: PID,
  applicationId: '0199e0a8-7c1b-7d2e-9f00-00000000eeee',
  channel: 'MOBILE_MONEY',
  provider: 'EVC_PLUS',
  reference: 'TX8839201',
  amountCents: '1900',
  overpaidCents: '0',
  refundedCents: '0',
  paidAt: '2026-10-13T09:00:00.000Z',
  status,
  rejectNote: null,
  receiptNo: status === 'CONFIRMED' ? 'R-2026-000001' : null,
  createdAt: '2026-10-13T10:00:00.000Z',
  applicationReferenceNo: 'GS-2026-000042',
  serviceName: 'Police clearance',
  applicantName: 'Amina Hassan',
  assessedCents: '1900',
  evidenceDocumentId: null,
  firstConfirmedById: null,
  payerName: null,
  ...overrides,
});

describe('officer payment review', () => {
  afterEach(() => {
    clearSession();
    vi.unstubAllGlobals();
  });

  it('should confirm a pending payment and report the receipt', async () => {
    let current = staffPayment('PENDING_VERIFICATION');
    const { calls } = mockApi({
      'POST /api/v1/auth/refresh': () => ({ status: 200, body: sessionFor('OFFICER', 'POLICE') }),
      [`GET /api/v1/staff/payments/${PID}`]: () => ({ status: 200, body: current }),
      'GET /api/v1/staff/reason-codes?kind=PAYMENT_REJECT': () => ({ status: 200, body: [] }),
      [`POST /api/v1/staff/payments/${PID}/confirm`]: () => {
        current = staffPayment('CONFIRMED');
        return { status: 200, body: current };
      },
    });
    renderRoute(`/officer/payments/${PID}`);
    expect(await screen.findByText('Amina Hassan')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: t.officerPayments.confirm }));
    expect(await screen.findByText(t.officerPayments.confirmed)).toBeInTheDocument();
    expect(calls.some((c) => c.key === `POST /api/v1/staff/payments/${PID}/confirm`)).toBe(true);
  });

  it('should not offer confirmation of a card payment', async () => {
    mockApi({
      'POST /api/v1/auth/refresh': () => ({ status: 200, body: sessionFor('OFFICER', 'POLICE') }),
      [`GET /api/v1/staff/payments/${PID}`]: () => ({
        status: 200,
        body: staffPayment('INITIATED', { channel: 'CARD' }),
      }),
    });
    renderRoute(`/officer/payments/${PID}`);
    expect(await screen.findByText('Amina Hassan')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.officerPayments.confirm }),
    ).not.toBeInTheDocument();
  });

  it('should hide refunds from officers (supervisor page)', async () => {
    mockApi({
      'POST /api/v1/auth/refresh': () => ({ status: 200, body: sessionFor('OFFICER', 'POLICE') }),
    });
    renderRoute('/officer/refunds');
    expect(await screen.findByRole('heading', { name: t.forbidden.heading })).toBeInTheDocument();
  });
});
