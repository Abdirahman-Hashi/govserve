import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../strings';
import { renderRoute } from '../test/render';

function mockReady(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  );
}

const time = '2026-10-13T12:00:00.000Z';

describe('HomePage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('should show the heading and the three pilot services when rendered', async () => {
    mockReady(200, { status: 'ok', version: 'dev', time, checks: { database: 'up', redis: 'up' } });
    renderRoute('/');
    expect(screen.getByRole('heading', { level: 1, name: t.home.heading })).toBeInTheDocument();
    for (const name of t.home.services) expect(screen.getByText(name)).toBeInTheDocument();
    expect(await screen.findByText(t.status.ok)).toBeInTheDocument();
  });

  it('should show a degraded message when the API reports 503', async () => {
    mockReady(503, {
      status: 'error',
      version: 'dev',
      time,
      checks: { database: 'up', redis: 'down' },
    });
    renderRoute('/');
    expect(await screen.findByText(t.status.degraded)).toBeInTheDocument();
  });

  it('should show an unreachable message when the response does not match the shared schema', async () => {
    mockReady(200, { unexpected: true });
    renderRoute('/');
    expect(await screen.findByText(t.status.unreachable)).toBeInTheDocument();
  });

  it('should render the not-found page when the route is unknown', () => {
    mockReady(200, { status: 'ok', version: 'dev', time });
    renderRoute('/nope');
    expect(screen.getByRole('heading', { name: t.notFound.heading })).toBeInTheDocument();
  });
});
