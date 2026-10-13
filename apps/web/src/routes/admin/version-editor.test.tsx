import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSession } from '../../auth/session-store';
import { t } from '../../strings';
import { policeDetail, versionFrom } from '../../test/catalogue-fixtures';
import { mockApi, sessionFor } from '../../test/fetch-mock';
import { renderRoute } from '../../test/render';

const draft = versionFrom(policeDetail);
const services = [
  {
    id: draft.serviceId,
    code: 'POLICE_CLEARANCE',
    departmentCode: 'POLICE',
    certificatePrefix: 'POL',
    name: 'Police clearance',
    description: 'A certificate from the CID.',
    active: true,
    slaWorkingDays: 10,
    inPersonStep: 'FINGERPRINTS',
    approvalMode: 'SUPERVISOR_ON_RECORD_FOUND',
    validityMonths: 6,
    subjectMode: 'SELF',
    publishedVersionNo: 1,
    draftVersionId: draft.id,
    feeIsTest: true,
  },
];

function setup(version = draft) {
  return mockApi({
    'POST /api/v1/auth/refresh': () => ({ status: 200, body: sessionFor('ADMIN') }),
    'GET /api/v1/admin/services': () => ({ status: 200, body: services }),
    [`GET /api/v1/admin/versions/${version.id}`]: () => ({ status: 200, body: version }),
    [`PATCH /api/v1/admin/versions/${version.id}`]: (body) => ({
      status: 200,
      body: { ...version, ...(body as object) },
    }),
    [`POST /api/v1/admin/versions/${version.id}/publish`]: () => ({
      status: 200,
      body: { ...version, status: 'PUBLISHED' },
    }),
  });
}

describe('version editor', () => {
  afterEach(() => {
    clearSession();
    vi.unstubAllGlobals();
  });

  it('should show the TEST badge and a live preview of the form', async () => {
    setup();
    renderRoute(`/admin/versions/${draft.id}`);
    expect(
      await screen.findByRole('heading', { name: 'Police clearance — version 2' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(t.versionEditor.testBadge).length).toBeGreaterThan(0);
    expect(screen.getByRole('textbox', { name: /^Full name/ })).toBeInTheDocument();
  });

  it('should block publishing while the definition has problems', async () => {
    setup();
    renderRoute(`/admin/versions/${draft.id}`);
    const name = await screen.findByLabelText(t.versionEditor.fieldName, {
      selector: '#fe-0-name',
    });
    await userEvent.clear(name);
    await userEvent.type(name, 'Bad Name');
    expect(screen.getByRole('alert')).toHaveTextContent('Field name "BadName" must be camelCase');
    expect(screen.getByRole('button', { name: t.versionEditor.publish })).toBeDisabled();
  });

  it('should save the edits and then publish after confirmation', async () => {
    const { calls } = setup();
    renderRoute(`/admin/versions/${draft.id}`);
    const base = await screen.findByLabelText(t.versionEditor.baseCents);
    await userEvent.clear(base);
    await userEvent.type(base, '1750');
    await userEvent.click(screen.getByRole('button', { name: t.versionEditor.publish }));
    await userEvent.click(screen.getByRole('button', { name: t.versionEditor.confirm }));
    expect(await screen.findByText(t.versionEditor.published)).toBeInTheDocument();

    const patch = calls.find((c) => c.key.startsWith('PATCH'));
    expect(patch?.body).toMatchObject({
      fee: { baseCents: '1750', perCopyCents: '200' },
      feeIsTest: true,
    });
    expect(calls.map((c) => c.key).filter((k) => !k.startsWith('GET'))).toEqual([
      'POST /api/v1/auth/refresh',
      `PATCH /api/v1/admin/versions/${draft.id}`,
      `POST /api/v1/admin/versions/${draft.id}/publish`,
    ]);
  });

  it('should be read-only for a published version', async () => {
    const live = versionFrom(policeDetail, { status: 'PUBLISHED' });
    setup(live);
    renderRoute(`/admin/versions/${live.id}`);
    expect(await screen.findByText(t.versionEditor.readOnly)).toBeInTheDocument();
    expect(screen.getByLabelText(t.versionEditor.baseCents)).toBeDisabled();
    expect(screen.queryByRole('button', { name: t.versionEditor.publish })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.versionEditor.retire })).toBeInTheDocument();
  });
});
