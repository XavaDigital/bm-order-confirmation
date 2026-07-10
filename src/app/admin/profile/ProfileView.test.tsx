import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileView } from './ProfileView';

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={props.alt as string} {...props} />;
  },
}));

const USER = { name: 'Jane Sales', email: 'jane@example.com', role: 'sales' as const };

function mockStatusOnce(enabled: boolean, backupCodesRemaining = 0) {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ enabled, backupCodesRemaining }),
  } as Response);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('ProfileView', () => {
  it('renders the user name, email, and role', async () => {
    mockStatusOnce(false);
    render(<ProfileView user={USER} />);

    expect(screen.getByText(/Jane Sales/)).toBeInTheDocument();
    expect(screen.getByText(/jane@example.com/)).toBeInTheDocument();
    expect(screen.getByText('sales')).toBeInTheDocument();
    await screen.findByRole('button', { name: /set up two-factor authentication/i });
  });

  it('shows the setup form (step 0) when 2FA is disabled', async () => {
    mockStatusOnce(false);
    render(<ProfileView user={USER} />);

    expect(await screen.findByPlaceholderText('Current password')).toBeInTheDocument();
  });

  it('shows the enabled view with remaining backup codes when 2FA is already enabled', async () => {
    mockStatusOnce(true, 6);
    render(<ProfileView user={USER} />);

    expect(await screen.findByText(/you have/i)).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
  });

  it('shows a low-backup-codes warning when 2 or fewer remain', async () => {
    mockStatusOnce(true, 2);
    render(<ProfileView user={USER} />);

    expect(await screen.findByText(/low on backup codes/i)).toBeInTheDocument();
  });

  it('does not show the low-backup-codes warning with more than 2 remaining', async () => {
    mockStatusOnce(true, 5);
    render(<ProfileView user={USER} />);

    await screen.findByText(/you have/i);
    expect(screen.queryByText(/low on backup codes/i)).not.toBeInTheDocument();
  });

  it('starting setup submits the password and advances to the QR step', async () => {
    const user = userEvent.setup();
    mockStatusOnce(false);
    render(<ProfileView user={USER} />);
    await screen.findByPlaceholderText('Current password');

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ secret: 'ABCD1234', qrDataUrl: 'data:image/png;base64,QR' }),
    } as Response);
    await user.type(screen.getByPlaceholderText('Current password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: /set up two-factor authentication/i }));

    expect(fetch).toHaveBeenLastCalledWith('/api/admin/auth/2fa/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'hunter2' }),
    });
    expect(await screen.findByAltText('2FA QR code')).toBeInTheDocument();
    expect(screen.getByText('ABCD1234')).toBeInTheDocument();
  });

  it('shows an error when starting setup fails', async () => {
    const user = userEvent.setup();
    mockStatusOnce(false);
    render(<ProfileView user={USER} />);
    await screen.findByPlaceholderText('Current password');

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Incorrect password' }),
    } as Response);
    await user.type(screen.getByPlaceholderText('Current password'), 'wrong');
    await user.click(screen.getByRole('button', { name: /set up two-factor authentication/i }));

    expect(await screen.findByText('Incorrect password')).toBeInTheDocument();
  });

  it('confirming the code shows backup codes and refetches status', async () => {
    const user = userEvent.setup();
    mockStatusOnce(false);
    render(<ProfileView user={USER} />);
    await screen.findByPlaceholderText('Current password');

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ secret: 'ABCD1234', qrDataUrl: 'data:image/png;base64,QR' }),
    } as Response);
    await user.type(screen.getByPlaceholderText('Current password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: /set up two-factor authentication/i }));
    await screen.findByAltText('2FA QR code');

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ backupCodes: ['aaaa-1111', 'bbbb-2222'] }),
    } as Response);
    mockStatusOnce(true, 10);
    await user.type(screen.getByPlaceholderText('000000'), '123456');
    await user.click(screen.getByRole('button', { name: /verify & enable/i }));

    expect(fetch).toHaveBeenCalledWith('/api/admin/auth/2fa/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '123456' }),
    });
    expect(await screen.findByText('aaaa-1111')).toBeInTheDocument();
    expect(screen.getByText('bbbb-2222')).toBeInTheDocument();
    expect(screen.getByText(/two-factor authentication enabled/i)).toBeInTheDocument();
  });

  it('shows an error when confirming the code fails', async () => {
    const user = userEvent.setup();
    mockStatusOnce(false);
    render(<ProfileView user={USER} />);
    await screen.findByPlaceholderText('Current password');

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ secret: 'ABCD1234', qrDataUrl: 'data:image/png;base64,QR' }),
    } as Response);
    await user.type(screen.getByPlaceholderText('Current password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: /set up two-factor authentication/i }));
    await screen.findByAltText('2FA QR code');

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid code' }),
    } as Response);
    await user.type(screen.getByPlaceholderText('000000'), '000000');
    await user.click(screen.getByRole('button', { name: /verify & enable/i }));

    expect(await screen.findByText('Invalid code')).toBeInTheDocument();
  });

  it('copying backup codes writes them to the clipboard', async () => {
    const user = userEvent.setup();
    mockStatusOnce(false);
    render(<ProfileView user={USER} />);
    await screen.findByPlaceholderText('Current password');

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ secret: 'ABCD1234', qrDataUrl: 'data:image/png;base64,QR' }),
    } as Response);
    await user.type(screen.getByPlaceholderText('Current password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: /set up two-factor authentication/i }));
    await screen.findByAltText('2FA QR code');

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ backupCodes: ['aaaa-1111', 'bbbb-2222'] }),
    } as Response);
    mockStatusOnce(true, 10);
    await user.type(screen.getByPlaceholderText('000000'), '123456');
    await user.click(screen.getByRole('button', { name: /verify & enable/i }));
    await screen.findByText('aaaa-1111');

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(screen.getByRole('button', { name: /copy backup codes/i }));

    expect(writeText).toHaveBeenCalledWith('aaaa-1111\nbbbb-2222');
    expect(await screen.findByText('Backup codes copied to clipboard')).toBeInTheDocument();
  });

  it('disabling 2FA submits the password, closes the modal, and refetches status', async () => {
    const user = userEvent.setup();
    mockStatusOnce(true, 8);
    render(<ProfileView user={USER} />);
    await screen.findByText(/you have/i);

    await user.click(screen.getByRole('button', { name: /disable two-factor authentication/i }));
    const dialog = await screen.findByRole('dialog');

    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);
    mockStatusOnce(false);
    await user.type(dialog.querySelector('input[type="password"]')!, 'hunter2');
    await user.click(screen.getByRole('button', { name: /^disable 2fa$/i }));

    expect(fetch).toHaveBeenCalledWith('/api/admin/auth/2fa/disable', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'hunter2' }),
    });
    expect(await screen.findByText('Two-factor authentication disabled')).toBeInTheDocument();
  });

  it('shows an error inside the modal when disabling fails', async () => {
    const user = userEvent.setup();
    mockStatusOnce(true, 8);
    render(<ProfileView user={USER} />);
    await screen.findByText(/you have/i);

    await user.click(screen.getByRole('button', { name: /disable two-factor authentication/i }));
    const dialog = await screen.findByRole('dialog');

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Incorrect password' }),
    } as Response);
    await user.type(dialog.querySelector('input[type="password"]')!, 'wrong');
    await user.click(screen.getByRole('button', { name: /^disable 2fa$/i }));

    expect(await screen.findByText('Incorrect password')).toBeInTheDocument();
  });
});
