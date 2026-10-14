import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSession } from '../../auth/session-store';
import { t } from '../../strings';
import { mockApi, sessionFor } from '../../test/fetch-mock';
import { renderRoute } from '../../test/render';

const ID = '0199e0a8-7c1b-7d2e-9f00-00000000ffff';
const detail = (overrides: object = {}) => ({
  id: ID,
  referenceNo: 'GS-2026-000077',
  serviceCode: 'PROOF_OF_ADDRESS',
  serviceName: 'Proof of address',
  status: 'CORRECTION_REQUESTED',
  createdAt: '2026-10-13T10:00:00.000Z',
  updatedAt: '2026-10-13T10:00:00.000Z',
  submittedAt: '2026-10-13T10:00:00.000Z',
  kind: 'STANDARD',
  extraCopies: 0,
  serviceVersionId: '0199e0a8-7c1b-7d2e-9f00-1a2b3c4d5e6f',
  formSchema: {
    type: 'object',
    properties: {
      fullName: { type: 'string', title: 'Full name' },
      district: { type: 'string', title: 'District', minLength: 2 },
    },
    required: ['fullName', 'district'],
  },
  uiSchema: { order: ['fullName', 'district'] },
  requiredDocuments: [],
  fee: { baseCents: '1000', perCopyCents: '200' },
  feeProvisional: true,
  formData: { fullName: 'Amina Hassan', district: 'Hodan' },
  documents: [],
  history: [],
  feeAssessment: null,
  payments: [],
  paidCents: '1000',
  balanceCents: '0',
  cardPaymentsEnabled: true,
  appointments: [],
  certificate: null,
  allowedActions: ['EDIT', 'RESUBMIT', 'WITHDRAW'],
  editableFields: ['district'],
  editableDocTypes: [],
  correction: {
    round: 1,
    dueAt: '2026-11-12T10:00:00.000Z',
    items: [
      { kind: 'FIELD', target: 'district', comment: 'This district does not match the bill' },
    ],
  },
  ...overrides,
});

describe('citizen corrections', () => {
  afterEach(() => {
    clearSession();
    vi.unstubAllGlobals();
  });

  it('should unlock only the flagged answer and resubmit', async () => {
    let current = detail();
    const { calls } = mockApi({
      'POST /api/v1/auth/refresh': () => ({ status: 200, body: sessionFor('CITIZEN') }),
      [`GET /api/v1/applications/${ID}`]: () => ({ status: 200, body: current }),
      [`PATCH /api/v1/applications/${ID}`]: () => ({
        status: 200,
        body: detail({ formData: { fullName: 'Amina Hassan', district: 'Wadajir' } }),
      }),
      [`POST /api/v1/applications/${ID}/resubmit`]: () => {
        current = detail({ status: 'IN_REVIEW', correction: null, allowedActions: ['WITHDRAW'] });
        return { status: 200, body: current };
      },
    });
    renderRoute(`/citizen/applications/${ID}`);
    expect(await screen.findByText(/This district does not match the bill/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Full name/)).not.toBeInTheDocument();
    const district = screen.getByLabelText(/District/);
    await userEvent.clear(district);
    await userEvent.type(district, 'Wadajir');
    await userEvent.click(screen.getByRole('button', { name: t.corrections.resubmit }));
    expect(await screen.findByText(t.applications.statuses['IN_REVIEW']!)).toBeInTheDocument();
    expect(calls.find((c) => c.key === `PATCH /api/v1/applications/${ID}`)?.body).toEqual({
      formData: { district: 'Wadajir' },
    });
    expect(calls.some((c) => c.key === `POST /api/v1/applications/${ID}/resubmit`)).toBe(true);
  });
});
