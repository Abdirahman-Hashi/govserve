import { type ApplicationDetail } from '@govserve/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSession } from '../../auth/session-store';
import { t } from '../../strings';
import { policeDetail } from '../../test/catalogue-fixtures';
import { mockApi, sessionFor } from '../../test/fetch-mock';
import { renderRoute } from '../../test/render';

const a = t.applications;
const ID = '0199e0a8-7c1b-7d2e-9f00-00000000aaaa';

function draft(overrides: Partial<ApplicationDetail> = {}): ApplicationDetail {
  return {
    id: ID,
    referenceNo: null,
    serviceCode: 'POLICE_CLEARANCE',
    serviceName: 'Police clearance',
    status: 'DRAFT',
    createdAt: '2026-10-13T10:00:00.000Z',
    updatedAt: '2026-10-13T10:00:00.000Z',
    submittedAt: null,
    kind: 'STANDARD',
    extraCopies: 0,
    serviceVersionId: policeDetail.versionId,
    formSchema: policeDetail.formSchema,
    uiSchema: policeDetail.uiSchema,
    requiredDocuments: policeDetail.requiredDocuments,
    fee: policeDetail.fee,
    feeProvisional: true,
    formData: {},
    documents: [],
    history: [{ fromStatus: null, toStatus: 'DRAFT', at: '2026-10-13T10:00:00.000Z', note: null }],
    feeAssessment: null,
    allowedActions: ['EDIT', 'DELETE'],
    editableFields: null,
    editableDocTypes: null,
    correction: null,
    ...overrides,
  };
}

function setup(app = draft(), routes: Parameters<typeof mockApi>[0] = {}) {
  let current = app;
  return mockApi({
    'POST /api/v1/auth/refresh': () => ({ status: 200, body: sessionFor('CITIZEN') }),
    [`GET /api/v1/applications/${ID}`]: () => ({ status: 200, body: current }),
    [`PATCH /api/v1/applications/${ID}`]: (body) => {
      const b = body as { formData?: Record<string, unknown>; extraCopies?: number };
      const formData = { ...current.formData };
      for (const [k, v] of Object.entries(b.formData ?? {})) {
        if (v === null) delete formData[k];
        else formData[k] = v as string;
      }
      current = { ...current, formData, extraCopies: b.extraCopies ?? current.extraCopies };
      return { status: 200, body: current };
    },
    ...routes,
  });
}

describe('application wizard', () => {
  afterEach(() => {
    clearSession();
    vi.unstubAllGlobals();
  });

  it('should block the step until its answers are valid', async () => {
    setup();
    renderRoute(`/citizen/applications/${ID}`);
    await userEvent.click(await screen.findByRole('button', { name: a.next }));
    expect(screen.getByText(a.fixStep)).toBeInTheDocument();
    expect(screen.getByText('Enter full name')).toBeInTheDocument();
    expect(screen.getByText(a.stepOf(1, 3), { exact: false })).toBeInTheDocument();
  });

  it('should autosave only the changed fields after typing stops', async () => {
    const { calls } = setup();
    renderRoute(`/citizen/applications/${ID}`);
    await userEvent.type(await screen.findByLabelText(/Full name/), 'Amina Hassan');
    await waitFor(() => expect(calls.some((c) => c.key.startsWith('PATCH'))).toBe(true), {
      timeout: 4000,
    });
    const patches = calls.filter((c) => c.key.startsWith('PATCH'));
    expect(patches).toHaveLength(1);
    expect(patches[0]!.body).toEqual({ formData: { fullName: 'Amina Hassan' } });
    expect(await screen.findByText(a.saved)).toBeInTheDocument();
  });

  it('should move to documents and show the checklist with any-one-of groups', async () => {
    setup(draft({ formData: { fullName: 'Amina Hassan', purpose: 'EMPLOYMENT' } }));
    renderRoute(`/citizen/applications/${ID}`);
    await userEvent.click(await screen.findByRole('button', { name: a.next }));
    expect(screen.getByRole('heading', { name: a.docs.heading })).toBeInTheDocument();
    const group = screen.getByRole('group', { name: a.docs.anyOne });
    expect(within(group).getByText('Leader letter')).toBeInTheDocument();
    expect(screen.getAllByText(a.docs.missing).length).toBe(3);
  });

  it('should refuse a file type the document does not accept without contacting the server', async () => {
    const { calls } = setup(
      draft({ formData: { fullName: 'Amina Hassan', purpose: 'EMPLOYMENT' } }),
    );
    renderRoute(`/citizen/applications/${ID}`);
    await userEvent.click(await screen.findByRole('button', { name: a.next }));
    const input = screen.getByLabelText<HTMLInputElement>(
      new RegExp(`${a.docs.choose}: Leader letter`),
    );
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'letter.png', {
      type: 'image/png',
    });
    await userEvent.upload(input, png, { applyAccept: false });
    expect(await screen.findByRole('alert')).toHaveTextContent(a.docs.problems.wrongType);
    expect(calls.some((c) => c.key.includes('/documents'))).toBe(false);
  });

  it('should list the server’s reasons when submit is refused', async () => {
    setup(draft({ formData: { fullName: 'Amina Hassan', purpose: 'EMPLOYMENT' } }), {
      [`POST /api/v1/applications/${ID}/submit`]: () => ({
        status: 422,
        body: {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Please complete the highlighted items before submitting.',
            details: [
              { path: 'documents.NATIONAL_ID_OR_PASSPORT', message: 'Upload this document' },
              { path: 'documents.PROOF', message: 'Upload this document' },
            ],
          },
        },
      }),
    });
    renderRoute(`/citizen/applications/${ID}`);
    await userEvent.click(await screen.findByRole('button', { name: a.next }));
    await userEvent.click(screen.getByRole('button', { name: a.next }));
    expect(screen.getByRole('heading', { name: a.review.heading })).toBeInTheDocument();
    expect(screen.getByTestId('fee-total')).toHaveTextContent('$15.00');
    await userEvent.click(screen.getByRole('button', { name: a.review.submit }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('National ID card or passport: Upload this document');
    expect(alert).toHaveTextContent(`${a.docs.anyOne}: Upload this document`);
  });

  it('should show the reference, assessed fee and withdraw for a submitted application', async () => {
    setup(
      draft({
        status: 'AWAITING_PAYMENT',
        referenceNo: 'GS-2026-000042',
        allowedActions: ['WITHDRAW'],
        feeAssessment: {
          totalCents: '1900',
          lines: [
            { code: 'BASE', qty: 1, unitCents: '1500', amountCents: '1500' },
            { code: 'COPY', qty: 2, unitCents: '200', amountCents: '400' },
          ],
        },
      }),
    );
    renderRoute(`/citizen/applications/${ID}`);
    expect(await screen.findByTestId('reference')).toHaveTextContent('GS-2026-000042');
    expect(screen.getByTestId('assessed-total')).toHaveTextContent('$19.00');
    expect(screen.getByText(a.statuses['AWAITING_PAYMENT']!)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: a.detail.withdraw })).toBeInTheDocument();
  });
});
