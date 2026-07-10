import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { UsersView } from './UsersView';

function staffUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'jane@example.com',
    name: 'Jane Sales',
    role: 'sales' as const,
    isActive: true,
    isPending: false,
    lastLoginAt: '2026-06-01T10:00:00Z',
    createdAt: '2026-05-01T10:00:00Z',
    ...overrides,
  };
}

function mockUsersOnce(users: ReturnType<typeof staffUser>[]) {
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => users } as Response);
}

function renderView(currentUserId = 'user-current') {
  return render(
    <AntdApp>
      <UsersView currentUserId={currentUserId} />
    </AntdApp>,
  );
}

async function rowFor(name: string) {
  return (await screen.findByText(name)).closest('tr') as HTMLElement;
}

// antd's Modal leave-transition (content zoom + mask fade) waits for real
// transitionend events before unmounting, which jsdom never dispatches on its
// own — sweep for the leaving nodes and fire it manually, retrying until the
// dialog is actually gone since the "leave-active" class lands a tick late.
async function waitForModalToClose() {
  await vi.waitFor(() => {
    document
      .querySelectorAll('.ant-zoom-leave-active, .ant-fade-leave-active')
      .forEach((el) => fireEvent.transitionEnd(el));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('UsersView', () => {
  it('fetches and renders a row per user', async () => {
    mockUsersOnce([staffUser()]);
    renderView();

    expect(fetch).toHaveBeenCalledWith('/api/admin/users');
    expect(await screen.findByText('Jane Sales')).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    const row = await rowFor('Jane Sales');
    expect(within(row).getByText('Active')).toBeInTheDocument();
  });

  it('shows a "You" tag next to the current user\'s row', async () => {
    mockUsersOnce([staffUser({ id: 'user-current' })]);
    renderView('user-current');

    expect(await screen.findByText('You')).toBeInTheDocument();
  });

  it('shows a Pending tag and no Active switch interaction for a pending invite', async () => {
    mockUsersOnce([staffUser({ isPending: true, isActive: false })]);
    renderView();

    expect(await screen.findByText('Pending')).toBeInTheDocument();
    const row = await rowFor('Jane Sales');
    expect(within(row).getByRole('switch')).toBeDisabled();
  });

  it('shows an Inactive tag for a deactivated user', async () => {
    mockUsersOnce([staffUser({ isActive: false })]);
    renderView();

    expect(await screen.findByText('Inactive')).toBeInTheDocument();
  });

  it('shows a dash for a user who has never logged in', async () => {
    mockUsersOnce([staffUser({ lastLoginAt: null })]);
    renderView();

    expect((await rowFor('Jane Sales'))).toHaveTextContent('—');
  });

  it("disables the current user's own role select and active switch", async () => {
    mockUsersOnce([staffUser({ id: 'user-current' })]);
    renderView('user-current');

    const row = await rowFor('Jane Sales');
    expect(await within(row).findByRole('combobox')).toBeDisabled();
    expect(within(row).getByRole('switch')).toBeDisabled();
  });

  it("changing another user's role PATCHes and updates the select", async () => {
    const user = userEvent.setup();
    mockUsersOnce([staffUser()]);
    renderView();

    const row = await rowFor('Jane Sales');
    await within(row).findByRole('combobox');

    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);
    await user.click(within(row).getByRole('combobox'));
    await user.click(await screen.findByText('Admin'));

    expect(fetch).toHaveBeenLastCalledWith('/api/admin/users/user-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(await screen.findByText('Role updated')).toBeInTheDocument();
  });

  it('toggling the Active switch PATCHes isActive and shows a message', async () => {
    const user = userEvent.setup();
    mockUsersOnce([staffUser({ isActive: true })]);
    renderView();

    const row = await rowFor('Jane Sales');
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);
    await user.click(await within(row).findByRole('switch'));

    expect(fetch).toHaveBeenLastCalledWith('/api/admin/users/user-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    });
    expect(await screen.findByText('User deactivated')).toBeInTheDocument();
  });

  it('cancelling a pending invite confirms, then deletes and removes the row', async () => {
    const user = userEvent.setup();
    mockUsersOnce([staffUser({ isPending: true })]);
    renderView();

    await user.click(await screen.findByRole('button', { name: 'Cancel invite' }));
    const confirmButtons = await screen.findAllByRole('button', { name: 'Cancel invite' });
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);
    await user.click(confirmButtons[confirmButtons.length - 1]);

    expect(fetch).toHaveBeenLastCalledWith('/api/admin/users/user-1', { method: 'DELETE' });
    expect(await screen.findByText('Invite cancelled')).toBeInTheDocument();
    expect(screen.queryByText('Jane Sales')).not.toBeInTheDocument();
  });

  it('inviting a user submits the form, refetches, and shows a success message', async () => {
    const user = userEvent.setup();
    mockUsersOnce([]);
    renderView();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /invite user/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText('Jane Smith'), 'New Person');
    await user.type(within(dialog).getByPlaceholderText('jane@example.com'), 'new@example.com');

    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);
    mockUsersOnce([staffUser({ name: 'New Person', email: 'new@example.com' })]);
    await user.click(within(dialog).getByRole('button', { name: /send invite/i }));

    await vi.waitFor(() => expect(fetch).toHaveBeenNthCalledWith(2, '/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Person', email: 'new@example.com', role: 'sales' }),
    }));
    expect(await screen.findByText('Invite sent to new@example.com')).toBeInTheDocument();
    await waitForModalToClose();
  });

  it('shows the setup link modal when the invite response has no email delivery configured', async () => {
    const user = userEvent.setup();
    mockUsersOnce([]);
    renderView();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /invite user/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText('Jane Smith'), 'New Person');
    await user.type(within(dialog).getByPlaceholderText('jane@example.com'), 'new@example.com');

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ setupUrl: 'http://localhost/accept-invite/raw-token' }),
    } as Response);
    mockUsersOnce([]);
    await user.click(within(dialog).getByRole('button', { name: /send invite/i }));

    expect(await screen.findByText('http://localhost/accept-invite/raw-token')).toBeInTheDocument();
  });

  it('shows an error message when inviting fails', async () => {
    const user = userEvent.setup();
    mockUsersOnce([]);
    renderView();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /invite user/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText('Jane Smith'), 'New Person');
    await user.type(within(dialog).getByPlaceholderText('jane@example.com'), 'dupe@example.com');

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Email already invited' }),
    } as Response);
    await user.click(within(dialog).getByRole('button', { name: /send invite/i }));

    expect(await screen.findByText('Email already invited')).toBeInTheDocument();
  });
});
