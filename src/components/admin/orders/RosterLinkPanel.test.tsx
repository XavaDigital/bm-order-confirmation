import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { RosterLinkPanel } from './RosterLinkPanel';

function renderPanel(props: Partial<React.ComponentProps<typeof RosterLinkPanel>> = {}) {
  return render(
    <AntdApp>
      <RosterLinkPanel
        orderId="order-1"
        hasActiveToken={false}
        locked={false}
        stats={{ total: 0, submitted: 0 }}
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

describe('RosterLinkPanel', () => {
  it('shows the "no link yet" state and a Generate link button when there is no active token', () => {
    renderPanel({ hasActiveToken: false });

    expect(screen.getByText(/no roster link generated yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate link/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revoke link/i })).not.toBeInTheDocument();
  });

  it('shows the "active link exists" state and a Revoke button when there is an active token', () => {
    renderPanel({ hasActiveToken: true });

    expect(screen.getByText(/active roster link exists/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /regenerate link/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revoke link/i })).toBeInTheDocument();
  });

  it('generating a link POSTs to the roster token endpoint and displays the returned url', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'raw-token', url: 'http://localhost/o/roster/raw-token' }),
    } as Response);
    renderPanel({ hasActiveToken: false });

    await user.click(screen.getByRole('button', { name: /generate link/i }));

    expect(await screen.findByText('http://localhost/o/roster/raw-token')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/admin/orders/order-1/roster/token', { method: 'POST' });
    expect(await screen.findByText(/roster link generated/i)).toBeInTheDocument();
  });

  it('revoking a link DELETEs the roster token endpoint after confirming, and hides the Revoke button', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);
    renderPanel({ hasActiveToken: true });

    await user.click(screen.getByRole('button', { name: /revoke link/i }));
    const confirmButton = await screen.findByRole('button', { name: 'Revoke' });
    await user.click(confirmButton);

    expect(fetch).toHaveBeenCalledWith('/api/admin/orders/order-1/roster/token', { method: 'DELETE' });
    expect(await screen.findByText(/roster link revoked/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revoke link/i })).not.toBeInTheDocument();
  });

  it('shows the server error message when generating a link fails', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Order not found' }),
    } as Response);
    renderPanel({ hasActiveToken: false });

    await user.click(screen.getByRole('button', { name: /generate link/i }));

    expect(await screen.findByText('Order not found')).toBeInTheDocument();
  });

  it('shows a progress bar with submission counts when there are members', () => {
    renderPanel({ stats: { total: 4, submitted: 1 } });

    expect(screen.getByText('1 of 4 submitted')).toBeInTheDocument();
  });

  it('does not show a progress bar when there are no members yet', () => {
    renderPanel({ stats: { total: 0, submitted: 0 } });

    expect(screen.queryByText(/submitted/i)).not.toBeInTheDocument();
  });

  it('locking the roster POSTs to the lock endpoint', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);
    renderPanel({ locked: false });

    await user.click(screen.getByRole('switch'));

    expect(fetch).toHaveBeenCalledWith('/api/admin/orders/order-1/roster/lock', { method: 'POST' });
    expect(await screen.findByText(/^roster locked$/i)).toBeInTheDocument();
  });

  it('unlocking the roster DELETEs the lock endpoint', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);
    renderPanel({ locked: true });

    await user.click(screen.getByRole('switch'));

    expect(fetch).toHaveBeenCalledWith('/api/admin/orders/order-1/roster/lock', { method: 'DELETE' });
    expect(await screen.findByText(/^roster unlocked$/i)).toBeInTheDocument();
  });

  it('starts the lock switch checked when locked=true', () => {
    renderPanel({ locked: true });

    expect(screen.getByRole('switch')).toBeChecked();
  });
});
