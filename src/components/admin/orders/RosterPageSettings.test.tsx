import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { installMockFetch, type MockRoute } from '@/test/mockFetch';
import { RosterPageSettings } from './RosterPageSettings';

const SETTINGS_URL = '/api/admin/orders/order-1/roster/page-settings';

function settings(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    password: 'kiwi',
    url: 'https://orders.example.com/team/1',
    adminPasswordSet: false,
    namesUppercase: false,
    ...overrides,
  };
}

function settingsRoute(body: unknown = settings()): MockRoute {
  return { match: SETTINGS_URL, method: 'GET', response: body };
}

function renderPanel() {
  return render(
    <AntdApp>
      <RosterPageSettings orderId="order-1" customerEmail="manager@example.com" />
    </AntdApp>,
  );
}

beforeEach(() => {
  installMockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RosterPageSettings — print names in CAPITALS', () => {
  it('renders the caps switch off (from GET) with its check-first help text', async () => {
    installMockFetch([settingsRoute()]);
    renderPanel();

    const caps = await screen.findByRole('switch', { name: 'Print names in CAPITALS' });
    expect(caps).not.toBeChecked();
    expect(
      screen.getByText(
        'Check with the customer first. Turning this on converts names already entered.',
      ),
    ).toBeInTheDocument();
  });

  it('turning it on PATCHes namesUppercase and reflects the returned state', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch([settingsRoute()]);
    addRoute({
      match: SETTINGS_URL,
      method: 'PATCH',
      response: settings({ namesUppercase: true }),
    });
    renderPanel();

    await user.click(await screen.findByRole('switch', { name: 'Print names in CAPITALS' }));

    await vi.waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch?.[0]).toBe(SETTINGS_URL);
      expect(JSON.parse(patch![1]!.body as string)).toEqual({ namesUppercase: true });
    });
    expect(
      await screen.findByRole('switch', { name: 'Print names in CAPITALS' }),
    ).toBeChecked();
  });

  it('shows the caps switch even when the team page itself is off', async () => {
    installMockFetch([settingsRoute(settings({ enabled: false, password: null }))]);
    renderPanel();

    expect(
      await screen.findByRole('switch', { name: 'Print names in CAPITALS' }),
    ).toBeInTheDocument();
    // The page toggle is off, but the caps setting still shows and works.
    expect(screen.getByRole('switch', { name: 'Roster page enabled' })).not.toBeChecked();
  });

  it('a server-side ON state renders the switch checked', async () => {
    installMockFetch([settingsRoute(settings({ namesUppercase: true }))]);
    renderPanel();

    expect(
      await screen.findByRole('switch', { name: 'Print names in CAPITALS' }),
    ).toBeChecked();
  });
});
