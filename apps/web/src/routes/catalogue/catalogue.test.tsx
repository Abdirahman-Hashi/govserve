import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSession } from '../../auth/session-store';
import { t } from '../../strings';
import { policeDetail } from '../../test/catalogue-fixtures';
import { mockApi, NO_SESSION } from '../../test/fetch-mock';
import { renderRoute } from '../../test/render';

describe('catalogue pages', () => {
  afterEach(() => {
    clearSession();
    vi.unstubAllGlobals();
  });

  it('should list services with fee, time and a provisional badge', async () => {
    mockApi({
      'POST /api/v1/auth/refresh': NO_SESSION,
      'GET /api/v1/catalogue/services': () => ({ status: 200, body: [policeDetail] }),
    });
    renderRoute('/services');
    const item = (await screen.findByRole('link', { name: policeDetail.name })).closest('li')!;
    expect(within(item).getByText(/From \$15\.00 · About 10 working days/)).toBeInTheDocument();
    expect(within(item).getByText(t.catalogue.provisionalShort)).toBeInTheDocument();
  });

  it('should update the fee estimate when extra copies change', async () => {
    mockApi({
      'POST /api/v1/auth/refresh': NO_SESSION,
      'GET /api/v1/catalogue/services/POLICE_CLEARANCE': () => ({
        status: 200,
        body: policeDetail,
      }),
    });
    renderRoute('/services/POLICE_CLEARANCE');
    expect(await screen.findByTestId('fee-total')).toHaveTextContent('$15.00');
    expect(screen.getByText(t.catalogue.provisional)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(t.catalogue.extraCopies), '3');
    expect(screen.getByTestId('fee-total')).toHaveTextContent('$21.00');
    expect(screen.getByText('3 extra copies × $2.00')).toBeInTheDocument();
  });

  it('should list "any one of" documents together', async () => {
    mockApi({
      'POST /api/v1/auth/refresh': NO_SESSION,
      'GET /api/v1/catalogue/services/POLICE_CLEARANCE': () => ({
        status: 200,
        body: policeDetail,
      }),
    });
    renderRoute('/services/POLICE_CLEARANCE');
    const group = (await screen.findByText(t.catalogue.anyOneOf)).closest('li')!;
    expect(within(group).getByText('Leader letter')).toBeInTheDocument();
    expect(within(group).getByText('Utility bill')).toBeInTheDocument();
  });

  it('should show the conditional field only when it applies and validate with the shared rules', async () => {
    mockApi({
      'POST /api/v1/auth/refresh': NO_SESSION,
      'GET /api/v1/catalogue/services/POLICE_CLEARANCE': () => ({
        status: 200,
        body: policeDetail,
      }),
    });
    renderRoute('/services/POLICE_CLEARANCE');
    await userEvent.click(await screen.findByRole('button', { name: t.catalogue.checkAnswers }));
    expect(screen.getByText('Enter full name')).toBeInTheDocument();
    expect(screen.getByText('Choose purpose of the certificate')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Destination country/)).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Full name/), 'Amina Hassan');
    await userEvent.click(screen.getByLabelText('Travel'));
    expect(screen.getByLabelText(/Destination country/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: t.catalogue.checkAnswers }));
    expect(screen.getByText('Enter destination country')).toBeInTheDocument();
    expect(screen.getByLabelText(/Destination country/)).toHaveAttribute('aria-invalid', 'true');

    await userEvent.type(screen.getByLabelText(/Destination country/), 'Kenya');
    await userEvent.click(screen.getByRole('button', { name: t.catalogue.checkAnswers }));
    expect(screen.getByText(t.catalogue.answersOk)).toBeInTheDocument();
  });
});
