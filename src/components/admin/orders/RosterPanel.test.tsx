import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { RosterPanel } from './RosterPanel';

function mockFetchOnce(body: unknown, ok = true) {
  vi.mocked(fetch).mockResolvedValueOnce({ ok, json: async () => body } as Response);
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
  vi.stubGlobal('fetch', vi.fn());
});

describe('RosterPanel', () => {
  it('fetches the roster for the given order on mount', async () => {
    mockFetchOnce({ members: [], currentAccess: null, stats: { total: 0, submitted: 0 }, locked: false });
    renderPanel();

    expect(fetch).toHaveBeenCalledWith('/api/admin/orders/order-1/roster');
    expect(await screen.findByText(/no team members yet/i)).toBeInTheDocument();
  });

  it('shows an error alert when the fetch fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'));
    renderPanel();

    expect(await screen.findByText('Failed to load team roster')).toBeInTheDocument();
  });

  it('renders fetched members with submitted/pending status tags', async () => {
    mockFetchOnce({
      members: [
        { id: 'm1', name: 'Alex', playerNumber: '7', email: 'alex@example.com', submittedAt: '2026-07-01T00:00:00Z' },
        { id: 'm2', name: 'Sam', playerNumber: null, email: null, submittedAt: null },
      ],
      currentAccess: { id: 'a1', createdAt: '2026-07-01T00:00:00Z', revokedAt: null },
      stats: { total: 2, submitted: 1 },
      locked: false,
    });
    renderPanel();

    expect(await screen.findByText('Alex')).toBeInTheDocument();
    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    // RosterLinkPanel reflects the fetched access/stats state.
    expect(screen.getByText('1 of 2 submitted')).toBeInTheDocument();
    expect(screen.getByText(/active roster link exists/i)).toBeInTheDocument();
  });

  it('adding a member POSTs to the members endpoint and appends the row', async () => {
    const user = userEvent.setup();
    mockFetchOnce({ members: [], currentAccess: null, stats: { total: 0, submitted: 0 }, locked: false });
    renderPanel();
    await screen.findByText(/no team members yet/i);

    mockFetchOnce({ id: 'm1', name: 'Alex', playerNumber: '7', email: null, submittedAt: null }, true);

    await user.type(screen.getByPlaceholderText('Name'), 'Alex');
    await user.type(screen.getByPlaceholderText('# (optional)'), '7');
    await user.click(screen.getByRole('button', { name: /add member/i }));

    expect(fetch).toHaveBeenCalledWith(
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
    mockFetchOnce({ members: [], currentAccess: null, stats: { total: 0, submitted: 0 }, locked: false });
    renderPanel();
    await screen.findByText(/no team members yet/i);

    await user.click(screen.getByRole('button', { name: /add member/i }));

    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1); // only the initial GET
  });

  it('editing a member PATCHes the endpoint and shows the updated value', async () => {
    const user = userEvent.setup();
    mockFetchOnce({
      members: [{ id: 'm1', name: 'Alex', playerNumber: '7', email: null, submittedAt: null }],
      currentAccess: null,
      stats: { total: 1, submitted: 0 },
      locked: false,
    });
    renderPanel();
    await screen.findByText('Alex');

    await user.click(iconButtons('anticon-edit')[0]);
    const nameInput = screen.getByDisplayValue('Alex');
    await user.clear(nameInput);
    await user.type(nameInput, 'Alexander');

    mockFetchOnce({ ok: true }, true);
    await user.click(iconButtons('anticon-check')[0]);

    expect(fetch).toHaveBeenLastCalledWith(
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
    mockFetchOnce({
      members: [{ id: 'm1', name: 'Alex', playerNumber: null, email: null, submittedAt: null }],
      currentAccess: null,
      stats: { total: 1, submitted: 0 },
      locked: false,
    });
    renderPanel();
    await screen.findByText('Alex');

    await user.click(iconButtons('anticon-delete')[0]);
    const confirmButton = await screen.findByRole('button', { name: 'Remove' });

    mockFetchOnce({ ok: true }, true);
    await user.click(confirmButton);

    expect(fetch).toHaveBeenLastCalledWith('/api/admin/orders/order-1/roster/members/m1', { method: 'DELETE' });
    expect(await screen.findByText(/no team members yet/i)).toBeInTheDocument();
  });

  it('shows a Remind action only for pending members with an email on file', async () => {
    mockFetchOnce({
      members: [
        { id: 'm1', name: 'Alex', playerNumber: '7', email: 'alex@example.com', submittedAt: null },
        { id: 'm2', name: 'Sam', playerNumber: null, email: null, submittedAt: null },
        { id: 'm3', name: 'Jo', playerNumber: null, email: 'jo@example.com', submittedAt: '2026-07-01T00:00:00Z' },
      ],
      currentAccess: null,
      stats: { total: 3, submitted: 1 },
      locked: false,
    });
    renderPanel();
    await screen.findByText('Alex');

    expect(screen.getAllByTitle('Send a reminder email')).toHaveLength(1);
  });

  it('sending a reminder POSTs to the remind endpoint and shows a success message', async () => {
    const user = userEvent.setup();
    mockFetchOnce({
      members: [{ id: 'm1', name: 'Alex', playerNumber: '7', email: 'alex@example.com', submittedAt: null }],
      currentAccess: null,
      stats: { total: 1, submitted: 0 },
      locked: false,
    });
    renderPanel();
    await screen.findByText('Alex');

    mockFetchOnce({ ok: true, url: 'http://localhost/o/roster/member/new-token' }, true);
    await user.click(screen.getByTitle('Send a reminder email'));

    expect(fetch).toHaveBeenCalledWith('/api/admin/orders/order-1/roster/members/m1/remind', { method: 'POST' });
    expect(await screen.findByText(/reminder sent to alex@example\.com/i)).toBeInTheDocument();
  });

  it('copying a member\'s individual link mints it and copies the url to the clipboard', async () => {
    const user = userEvent.setup();
    mockFetchOnce({
      members: [{ id: 'm1', name: 'Alex', playerNumber: '7', email: null, submittedAt: null }],
      currentAccess: null,
      stats: { total: 1, submitted: 0 },
      locked: false,
    });
    renderPanel();
    await screen.findByText('Alex');

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mockFetchOnce({ token: 'raw-token', url: 'http://localhost/o/roster/member/raw-token' }, true);
    await user.click(screen.getByTitle('Copy this member\'s individual link'));

    expect(fetch).toHaveBeenCalledWith('/api/admin/orders/order-1/roster/members/m1/link', { method: 'POST' });
    expect(writeText).toHaveBeenCalledWith('http://localhost/o/roster/member/raw-token');
    expect(await screen.findByText(/alex's individual link copied to clipboard/i)).toBeInTheDocument();
  });

  it('emailing everyone their individual link POSTs to the bulk endpoint and reports counts', async () => {
    const user = userEvent.setup();
    mockFetchOnce({
      members: [
        { id: 'm1', name: 'Alex', playerNumber: '7', email: 'alex@example.com', submittedAt: null },
        { id: 'm2', name: 'Sam', playerNumber: null, email: null, submittedAt: null },
      ],
      currentAccess: null,
      stats: { total: 2, submitted: 0 },
      locked: false,
    });
    renderPanel();
    await screen.findByText('Alex');

    mockFetchOnce({ sent: 1, skippedNoEmail: 1, total: 2 }, true);
    await user.click(screen.getByRole('button', { name: /email everyone their link/i }));

    expect(fetch).toHaveBeenCalledWith('/api/admin/orders/order-1/roster/email-links', { method: 'POST' });
    expect(await screen.findByText(/individual links emailed to 1 of 2 members \(1 had no email on file\)/i)).toBeInTheDocument();
  });
});
