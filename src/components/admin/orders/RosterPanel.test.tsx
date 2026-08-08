import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { installMockFetch, type MockRoute } from '@/test/mockFetch';
import { RosterPanel } from './RosterPanel';

const ROSTER_URL = '/api/admin/orders/order-1/roster';

function rosterRoute(body: unknown): MockRoute {
  return { match: ROSTER_URL, method: 'GET', response: body };
}

function emptyRoster() {
  return { members: [], currentAccess: null, stats: { total: 0, submitted: 0 }, locked: false };
}

function renderPanel() {
  return render(
    <AntdApp>
      <RosterPanel orderId="order-1" customerEmail="manager@example.com" />
    </AntdApp>,
  );
}

function iconButtons(iconClass: string) {
  return screen.getAllByRole('button').filter((b) => b.querySelector(`.${iconClass}`));
}

beforeEach(() => {
  // Default: any request throws loudly; tests install their own routes.
  installMockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RosterPanel', () => {
  it('fetches the roster for the given order on mount', async () => {
    const { fetchMock } = installMockFetch([rosterRoute(emptyRoster())]);
    renderPanel();

    expect(fetchMock).toHaveBeenCalledWith(ROSTER_URL);
    expect(await screen.findByText(/no team members yet/i)).toBeInTheDocument();
  });

  it('shows an error alert when the fetch fails', async () => {
    // No routes registered — the mount GET rejects loudly, like a network failure.
    renderPanel();

    expect(await screen.findByText('Failed to load team roster')).toBeInTheDocument();
  });

  it('renders fetched members with submitted/pending status tags', async () => {
    installMockFetch([
      rosterRoute({
        members: [
          { id: 'm1', name: 'Alex', playerNumber: '7', email: 'alex@example.com', submittedAt: '2026-07-01T00:00:00Z' },
          { id: 'm2', name: 'Sam', playerNumber: null, email: null, submittedAt: null },
        ],
        currentAccess: { id: 'a1', createdAt: '2026-07-01T00:00:00Z', revokedAt: null },
        stats: { total: 2, submitted: 1 },
        locked: false,
      }),
    ]);
    renderPanel();

    expect(await screen.findByText('Alex')).toBeInTheDocument();
    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    // The progress stat (formerly on the removed token-link panel).
    expect(screen.getByText('1 of 2 submitted')).toBeInTheDocument();
  });

  it('adding a member POSTs to the members endpoint and appends the row', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch([rosterRoute(emptyRoster())]);
    renderPanel();
    await screen.findByText(/no team members yet/i);

    addRoute({
      match: `${ROSTER_URL}/members`,
      method: 'POST',
      response: { id: 'm1', name: 'Alex', playerNumber: '7', email: null, submittedAt: null },
    });

    await user.type(screen.getByPlaceholderText('Name'), 'Alex');
    await user.type(screen.getByPlaceholderText('# (optional)'), '7');
    await user.click(screen.getByRole('button', { name: /add member/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/roster/members',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alex', playerNumber: '7', email: undefined }),
      }),
    );
    expect(await screen.findByText('Alex')).toBeInTheDocument();
    expect(await screen.findByText(/team member added/i)).toBeInTheDocument();
  });

  it('rejects adding a member with a blank name without calling the API', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([rosterRoute(emptyRoster())]);
    renderPanel();
    await screen.findByText(/no team members yet/i);

    await user.click(screen.getByRole('button', { name: /add member/i }));

    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    // Only the mount-time GETs (roster + the roster-page settings) — no POST.
    const nonGet = fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');
    expect(nonGet).toHaveLength(0);
  });

  it('editing a member PATCHes the endpoint and shows the updated value', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch([
      rosterRoute({
        members: [{ id: 'm1', name: 'Alex', playerNumber: '7', email: null, submittedAt: null }],
        currentAccess: null,
        stats: { total: 1, submitted: 0 },
        locked: false,
      }),
    ]);
    renderPanel();
    await screen.findByText('Alex');

    await user.click(iconButtons('anticon-edit')[0]);
    const nameInput = screen.getByDisplayValue('Alex');
    await user.clear(nameInput);
    await user.type(nameInput, 'Alexander');

    addRoute({ match: `${ROSTER_URL}/members/m1`, method: 'PATCH', response: { ok: true } });
    await user.click(iconButtons('anticon-check')[0]);

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/orders/order-1/roster/members/m1',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alexander', playerNumber: '7', email: null }),
      }),
    );
    expect(await screen.findByText('Alexander')).toBeInTheDocument();
  });

  it('removing a member asks for confirmation and DELETEs the endpoint', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch([
      rosterRoute({
        members: [{ id: 'm1', name: 'Alex', playerNumber: null, email: null, submittedAt: null }],
        currentAccess: null,
        stats: { total: 1, submitted: 0 },
        locked: false,
      }),
    ]);
    renderPanel();
    await screen.findByText('Alex');

    await user.click(iconButtons('anticon-delete')[0]);
    const confirmButton = await screen.findByRole('button', { name: 'Remove' });

    addRoute({ match: `${ROSTER_URL}/members/m1`, method: 'DELETE', response: { ok: true } });
    await user.click(confirmButton);

    expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/orders/order-1/roster/members/m1', { method: 'DELETE' });
    expect(await screen.findByText(/no team members yet/i)).toBeInTheDocument();
  });

  it('shows a Remind action only for pending members with an email on file', async () => {
    installMockFetch([
      rosterRoute({
        members: [
          { id: 'm1', name: 'Alex', playerNumber: '7', email: 'alex@example.com', submittedAt: null },
          { id: 'm2', name: 'Sam', playerNumber: null, email: null, submittedAt: null },
          { id: 'm3', name: 'Jo', playerNumber: null, email: 'jo@example.com', submittedAt: '2026-07-01T00:00:00Z' },
        ],
        currentAccess: null,
        stats: { total: 3, submitted: 1 },
        locked: false,
      }),
    ]);
    renderPanel();
    await screen.findByText('Alex');

    expect(screen.getAllByTitle('Send a reminder email')).toHaveLength(1);
  });

  it('sending a reminder POSTs to the remind endpoint and shows a success message', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch([
      rosterRoute({
        members: [{ id: 'm1', name: 'Alex', playerNumber: '7', email: 'alex@example.com', submittedAt: null }],
        currentAccess: null,
        stats: { total: 1, submitted: 0 },
        locked: false,
      }),
    ]);
    renderPanel();
    await screen.findByText('Alex');

    addRoute({
      match: `${ROSTER_URL}/members/m1/remind`,
      method: 'POST',
      response: { ok: true, url: 'http://localhost/o/roster/member/new-token' },
    });
    await user.click(screen.getByTitle('Send a reminder email'));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/roster/members/m1/remind',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(await screen.findByText(/reminder sent to alex@example\.com/i)).toBeInTheDocument();
  });

  it('copying a member\'s individual link mints it and copies the url to the clipboard', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch([
      rosterRoute({
        members: [{ id: 'm1', name: 'Alex', playerNumber: '7', email: null, submittedAt: null }],
        currentAccess: null,
        stats: { total: 1, submitted: 0 },
        locked: false,
      }),
    ]);
    renderPanel();
    await screen.findByText('Alex');

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    addRoute({
      match: `${ROSTER_URL}/members/m1/link`,
      method: 'POST',
      response: { token: 'raw-token', url: 'http://localhost/o/roster/member/raw-token' },
    });
    await user.click(screen.getByTitle('Copy this member\'s individual link'));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/roster/members/m1/link',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(writeText).toHaveBeenCalledWith('http://localhost/o/roster/member/raw-token');
    expect(await screen.findByText(/alex's individual link copied to clipboard/i)).toBeInTheDocument();
  });

  it('emailing everyone their individual link POSTs to the bulk endpoint and reports counts', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch([
      rosterRoute({
        members: [
          { id: 'm1', name: 'Alex', playerNumber: '7', email: 'alex@example.com', submittedAt: null },
          { id: 'm2', name: 'Sam', playerNumber: null, email: null, submittedAt: null },
        ],
        currentAccess: null,
        stats: { total: 2, submitted: 0 },
        locked: false,
      }),
    ]);
    renderPanel();
    await screen.findByText('Alex');

    addRoute({
      match: `${ROSTER_URL}/email-links`,
      method: 'POST',
      response: { sent: 1, skippedNoEmail: 1, total: 2 },
    });
    await user.click(screen.getByRole('button', { name: /email everyone their link/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/roster/email-links',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(await screen.findByText(/individual links emailed to 1 of 2 members \(1 had no email on file\)/i)).toBeInTheDocument();
  });
});

/**
 * Locking the roster (David, 2026-08-08: "the admin should be able to lock the
 * roster"). The endpoint and the customer-side enforcement existed all along;
 * the 2026-08-04 redesign removed the only control that called it, so the
 * feature was unreachable from the screen for four days.
 */
describe('RosterPanel — locking', () => {
  it('locks the roster and re-reads it', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch([rosterRoute(emptyRoster())]);
    renderPanel();
    await screen.findByRole('button', { name: /lock roster/i });

    addRoute({ match: `${ROSTER_URL}/lock`, method: 'POST', response: { ok: true } });
    await user.click(screen.getByRole('button', { name: /lock roster/i }));
    // Popconfirm — locking is what makes the sizes final, so it asks first.
    await user.click(await screen.findByRole('button', { name: 'Lock' }));

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`${ROSTER_URL}/lock`, expect.objectContaining({ method: 'POST' })),
    );
    // Re-read rather than assume: locking finalises the sizes. Counting the
    // roster GETs specifically, since the panel also loads page settings.
    await vi.waitFor(() => {
      const rosterGets = fetchMock.mock.calls.filter(
        ([url, init]) => url === ROSTER_URL && (!init || !init.method || init.method === 'GET'),
      );
      expect(rosterGets.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows a locked roster as locked, and offers to reopen it', async () => {
    installMockFetch([rosterRoute({ ...emptyRoster(), locked: true })]);
    renderPanel();

    expect(await screen.findByText('Roster locked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /unlock roster/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^lock roster$/i })).not.toBeInTheDocument();
  });

  it('reopens a locked roster through the same endpoint', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch([
      rosterRoute({ ...emptyRoster(), locked: true }),
    ]);
    renderPanel();
    await screen.findByRole('button', { name: /unlock roster/i });

    addRoute({ match: `${ROSTER_URL}/lock`, method: 'DELETE', response: { ok: true } });
    await user.click(screen.getByRole('button', { name: /unlock roster/i }));
    await user.click(await screen.findByRole('button', { name: 'Reopen' }));

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `${ROSTER_URL}/lock`,
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });
});
