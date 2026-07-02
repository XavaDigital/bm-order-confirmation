import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { ShareLinkPanel } from './ShareLinkPanel';

function renderPanel(props: Partial<React.ComponentProps<typeof ShareLinkPanel>> = {}) {
  return render(
    <AntdApp>
      <ShareLinkPanel
        orderId="order-1"
        customerEmail="jane@example.com"
        hasActiveToken={false}
        {...props}
      />
    </AntdApp>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ShareLinkPanel', () => {
  it('shows the "no link yet" state and a Generate link button when there is no active token', () => {
    renderPanel({ hasActiveToken: false });

    expect(screen.getByText(/no customer link generated yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate link/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revoke link/i })).not.toBeInTheDocument();
  });

  it('shows the "active link exists" state and a Revoke button when there is an active token', () => {
    renderPanel({ hasActiveToken: true });

    expect(screen.getByText(/active link exists/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /regenerate link/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revoke link/i })).toBeInTheDocument();
  });

  it('generating a link POSTs to the token endpoint and displays the returned url', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'raw-token', url: 'http://localhost/o/raw-token' }),
    } as Response);
    renderPanel({ hasActiveToken: false });

    await user.click(screen.getByRole('button', { name: /generate link/i }));

    expect(await screen.findByText('http://localhost/o/raw-token')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/admin/orders/order-1/token', { method: 'POST' });
    expect(await screen.findByText(/customer link generated/i)).toBeInTheDocument();
  });

  it('revoking a link DELETEs the token endpoint after confirming, and hides the Revoke button', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);
    renderPanel({ hasActiveToken: true });

    await user.click(screen.getByRole('button', { name: /revoke link/i }));
    const confirmButton = await screen.findByRole('button', { name: 'Revoke' });
    await user.click(confirmButton);

    expect(fetch).toHaveBeenCalledWith('/api/admin/orders/order-1/token', { method: 'DELETE' });
    expect(await screen.findByText(/link revoked/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revoke link/i })).not.toBeInTheDocument();
  });

  it('emailing the link shows a "not configured" message on a 503 without changing hasToken', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'Email delivery is not configured on this server.' }),
    } as Response);
    renderPanel({ hasActiveToken: false });

    await user.click(screen.getByRole('button', { name: /email to customer/i }));

    expect(await screen.findByText(/email delivery is not configured/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate link/i })).toBeInTheDocument();
  });

  it('emailing the link on success shows the emailed confirmation and reveals the url', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, url: 'http://localhost/o/fresh-token' }),
    } as Response);
    renderPanel({ hasActiveToken: false });

    await user.click(screen.getByRole('button', { name: /email to customer/i }));

    expect(await screen.findByText(/link emailed to jane@example.com/i)).toBeInTheDocument();
    expect(screen.getByText('http://localhost/o/fresh-token')).toBeInTheDocument();
  });

  it('copies the url to the clipboard when Copy is clicked', async () => {
    const user = userEvent.setup();
    // user-event installs its own navigator.clipboard stub during setup(), so ours
    // must be defined after that (and after render, which also runs before the
    // click) or user-event's stub silently wins.
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'raw-token', url: 'http://localhost/o/raw-token' }),
    } as Response);
    renderPanel({ hasActiveToken: false });

    await user.click(screen.getByRole('button', { name: /generate link/i }));
    await screen.findByText('http://localhost/o/raw-token');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(screen.getByRole('button', { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith('http://localhost/o/raw-token');
  });
});
