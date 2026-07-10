import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TwoFactorForm } from './TwoFactorForm';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

beforeEach(() => {
  pushMock.mockClear();
  refreshMock.mockClear();
  vi.stubGlobal('fetch', vi.fn());
});

describe('TwoFactorForm', () => {
  it('renders the authenticator-app prompt by default', () => {
    render(<TwoFactorForm />);

    expect(screen.getByText(/enter the 6-digit code from your authenticator app/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('000000')).toBeInTheDocument();
  });

  it('toggling to backup code changes the prompt, placeholder, and max length', async () => {
    const user = userEvent.setup();
    render(<TwoFactorForm />);

    await user.click(screen.getByRole('button', { name: /use a backup code/i }));

    expect(screen.getByText(/enter one of your backup codes/i)).toBeInTheDocument();
    const input = screen.getByPlaceholderText('XXXXX-XXXXX');
    expect(input).toHaveAttribute('maxLength', '11');

    await user.click(screen.getByRole('button', { name: /use authenticator app instead/i }));
    expect(screen.getByPlaceholderText('000000')).toHaveAttribute('maxLength', '6');
  });

  it('a successful verification redirects to the dashboard and refreshes', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);
    render(<TwoFactorForm />);

    await user.type(screen.getByPlaceholderText('000000'), '123456');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    expect(fetch).toHaveBeenCalledWith('/api/auth/2fa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '123456' }),
    });
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/admin/dashboard'));
    expect(refreshMock).toHaveBeenCalled();
  });

  it('trims whitespace from the code before submitting', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);
    render(<TwoFactorForm />);

    // The input has maxLength=6, so simulate a pasted/autofilled value with
    // surrounding whitespace directly rather than via user-event typing.
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: ' 1234 ' } });
    await user.click(screen.getByRole('button', { name: /verify/i }));

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.code).toBe('1234');
  });

  it('shows the server error message when verification fails', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid code' }),
    } as Response);
    render(<TwoFactorForm />);

    await user.type(screen.getByPlaceholderText('000000'), '000000');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    expect(await screen.findByText('Invalid code')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('shows a generic error message on a network failure', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'));
    render(<TwoFactorForm />);

    await user.type(screen.getByPlaceholderText('000000'), '123456');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    expect(await screen.findByText('An unexpected error occurred. Please try again.')).toBeInTheDocument();
  });

  it('clears a previous error when switching between authenticator and backup code modes', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid code' }),
    } as Response);
    render(<TwoFactorForm />);

    await user.type(screen.getByPlaceholderText('000000'), '000000');
    await user.click(screen.getByRole('button', { name: /verify/i }));
    expect(await screen.findByText('Invalid code')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /use a backup code/i }));

    expect(screen.queryByText('Invalid code')).not.toBeInTheDocument();
  });
});
