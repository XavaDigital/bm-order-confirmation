import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserMenu } from './UserMenu';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

beforeEach(() => {
  pushMock.mockClear();
  refreshMock.mockClear();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true } as Response));
});

describe('UserMenu', () => {
  it('shows the name and role in the collapsed-sidebar trigger', () => {
    render(<UserMenu name="Jane Sales" email="jane@example.com" role="sales" />);

    expect(screen.getByText('Jane Sales')).toBeInTheDocument();
    expect(screen.getByText('sales')).toBeInTheDocument();
  });

  it('opens the dropdown and shows the email and role info', async () => {
    const user = userEvent.setup();
    render(<UserMenu name="Jane Sales" email="jane@example.com" role="admin" />);

    await user.click(screen.getByText('Jane Sales'));

    expect(await screen.findByText('jane@example.com')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /security \(2fa\)/i })).toBeInTheDocument();
  });

  it('signing out calls the logout endpoint and redirects to /login', async () => {
    const user = userEvent.setup();
    render(<UserMenu name="Jane Sales" email="jane@example.com" role="sales" />);

    await user.click(screen.getByText('Jane Sales'));
    await user.click(await screen.findByText('Sign out'));

    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
    expect(refreshMock).toHaveBeenCalled();
  });
});
