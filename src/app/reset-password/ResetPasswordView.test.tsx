import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResetPasswordView } from './ResetPasswordView';

const pushMock = vi.fn();
let searchParamsValue = new URLSearchParams('token=raw-token-abc');
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsValue,
}));

beforeEach(() => {
  pushMock.mockClear();
  searchParamsValue = new URLSearchParams('token=raw-token-abc');
  vi.stubGlobal('fetch', vi.fn());
});

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, password = 'brand-new-password-1', confirm = password) {
  await user.type(screen.getByLabelText('New Password'), password);
  await user.type(screen.getByLabelText('Confirm New Password'), confirm);
  await user.click(screen.getByRole('button', { name: /reset password/i }));
}

describe('ResetPasswordView', () => {
  it('shows an error when the token is missing from the URL', () => {
    searchParamsValue = new URLSearchParams();
    render(<ResetPasswordView />);

    expect(screen.getByText('Invalid reset link')).toBeInTheDocument();
    expect(screen.queryByLabelText('New Password')).not.toBeInTheDocument();
  });

  it('shows a validation error when the confirmation does not match', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordView />);

    await fillAndSubmit(user, 'brand-new-password-1', 'does-not-match');

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts the token and password, then redirects to login on success', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);
    render(<ResetPasswordView />);

    await fillAndSubmit(user);

    expect(fetch).toHaveBeenCalledWith('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'raw-token-abc', password: 'brand-new-password-1' }),
    });
    expect(await screen.findByText('Password updated!')).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(2000);
    expect(pushMock).toHaveBeenCalledWith('/login?reset=1');
    vi.useRealTimers();
  });

  it('shows an expired-link message with a link back to forgot-password on a 410', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 410,
      json: async () => ({ error: 'This password reset link has expired or is invalid' }),
    } as Response);
    render(<ResetPasswordView />);

    await fillAndSubmit(user);

    expect(await screen.findByText('This link has expired')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request a new one/i })).toHaveAttribute('href', '/forgot-password');
  });

  it('shows a generic error for a non-410 failure', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal server error' }),
    } as Response);
    render(<ResetPasswordView />);

    await fillAndSubmit(user);

    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
  });
});
