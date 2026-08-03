import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { installMockFetch } from '@/test/mockFetch';
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
  // Default: any request throws loudly; tests that fetch install their own routes.
  installMockFetch();
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

  it('shows the stored URL on mount when initialUrl is provided (readable at rest)', () => {
    renderPanel({ hasActiveToken: true, initialUrl: 'http://localhost/o/stored-token' });

    expect(screen.getByText('http://localhost/o/stored-token')).toBeInTheDocument();
    // No legacy "URL not shown" warning, and no auto-generate call was needed.
    expect(screen.queryByText(/url not shown/i)).not.toBeInTheDocument();
  });

  it('auto-generates a link on mount (with an access code) and displays the returned url', async () => {
    const { fetchMock } = installMockFetch([
      {
        match: '/api/admin/orders/order-1/token',
        method: 'POST',
        response: { token: 'raw-token', url: 'http://localhost/o/raw-token' },
      },
      { match: '/api/admin/orders/order-1/access-code', method: 'POST', response: { code: '483920' } },
    ]);
    renderPanel({ hasActiveToken: false });

    // No click: the panel generates on first view (David, 2026-08-04) and
    // defaults the access code ON for the fresh link.
    expect(await screen.findByText('http://localhost/o/raw-token')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/token',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/access-code',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('revoking a link DELETEs the token endpoint after confirming, and hides the Revoke button', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([
      { match: '/api/admin/orders/order-1/token', method: 'DELETE', response: {} },
    ]);
    renderPanel({ hasActiveToken: true });

    await user.click(screen.getByRole('button', { name: /revoke link/i }));
    const confirmButton = await screen.findByRole('button', { name: 'Revoke' });
    await user.click(confirmButton);

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/orders/order-1/token', { method: 'DELETE' });
    expect(await screen.findByText(/link revoked/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revoke link/i })).not.toBeInTheDocument();
  });

  it('emailing the link shows a "not configured" message on a 503 without changing hasToken', async () => {
    const user = userEvent.setup();
    installMockFetch([
      {
        match: '/api/admin/orders/order-1/send-link',
        method: 'POST',
        status: 503,
        response: { error: 'Email delivery is not configured on this server.' },
      },
    ]);
    renderPanel({ hasActiveToken: false });

    await user.click(screen.getByRole('button', { name: /email to customer/i }));

    expect(await screen.findByText(/email delivery is not configured/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate link/i })).toBeInTheDocument();
  });

  it('emailing the link on success shows the emailed confirmation and reveals the url', async () => {
    const user = userEvent.setup();
    installMockFetch([
      {
        match: '/api/admin/orders/order-1/send-link',
        method: 'POST',
        response: { ok: true, url: 'http://localhost/o/fresh-token' },
      },
    ]);
    renderPanel({ hasActiveToken: false });

    await user.click(screen.getByRole('button', { name: /email to customer/i }));

    expect(await screen.findByText(/link emailed to jane@example.com/i)).toBeInTheDocument();
    expect(screen.getByText('http://localhost/o/fresh-token')).toBeInTheDocument();
  });

  it('disables the access-code switch when there is no active link', () => {
    renderPanel({ hasActiveToken: false });

    expect(screen.getByText(/require access code/i)).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeDisabled();
  });

  it('enabling the access code POSTs and shows the code once with a copy warning', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([
      { match: '/api/admin/orders/order-1/access-code', method: 'POST', response: { code: '483920' } },
    ]);
    renderPanel({ hasActiveToken: true, hasAccessCode: false });

    await user.click(screen.getByRole('switch'));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/access-code',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(await screen.findByText('483920')).toBeInTheDocument();
    expect(await screen.findByText(/access code set/i)).toBeInTheDocument();
  });

  // Codes are staff-readable on demand (David, 2026-08-03) — an active code
  // loads and displays instead of the old "not shown, regenerate" state.
  it('loads and displays the stored code when a code is active', async () => {
    installMockFetch([
      {
        match: '/api/admin/orders/order-1/access-code',
        method: 'GET',
        response: { code: 'seahawks22', enabled: true, legacy: false },
      },
    ]);
    renderPanel({ hasActiveToken: true, hasAccessCode: true });

    expect(await screen.findByText('seahawks22')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set custom code/i })).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('shows the legacy notice when the active code predates readability', async () => {
    installMockFetch([
      {
        match: '/api/admin/orders/order-1/access-code',
        method: 'GET',
        response: { code: null, enabled: true, legacy: true },
      },
    ]);
    renderPanel({ hasActiveToken: true, hasAccessCode: true });

    expect(
      await screen.findByText(/set before codes became viewable/i),
    ).toBeInTheDocument();
  });

  it('disabling the access code DELETEs and clears the code state', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([
      {
        match: '/api/admin/orders/order-1/access-code',
        method: 'GET',
        response: { code: '123456', enabled: true, legacy: false },
      },
      { match: '/api/admin/orders/order-1/access-code', method: 'DELETE', response: { ok: true } },
    ]);
    renderPanel({ hasActiveToken: true, hasAccessCode: true });

    await user.click(screen.getByRole('switch'));

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/orders/order-1/access-code', { method: 'DELETE' });
    expect(await screen.findByText(/access code removed/i)).toBeInTheDocument();
    expect(screen.queryByText(/access code active/i)).not.toBeInTheDocument();
  });

  it('blocks link generation and shows an error banner when the order has no garments', async () => {
    renderPanel({ hasActiveToken: false, garmentSummary: { total: 0, missingSizing: [], missingImages: [] } });

    expect(screen.getByText(/this order has no garments/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate link/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /email to customer/i })).toBeDisabled();
  });

  it('shows a non-blocking warning banner listing garments missing sizing or mock-ups', () => {
    renderPanel({
      hasActiveToken: false,
      garmentSummary: { total: 2, missingSizing: ['Away Jersey'], missingImages: ['Home Jersey'] },
    });

    expect(screen.getByText(/this order looks incomplete/i)).toBeInTheDocument();
    expect(screen.getByText(/no sizing\/roster entered: away jersey/i)).toBeInTheDocument();
    expect(screen.getByText(/no mock-up image uploaded: home jersey/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate link/i })).toBeEnabled();
  });

  it('shows the server error message when generating a link fails', async () => {
    const user = userEvent.setup();
    installMockFetch([
      {
        match: '/api/admin/orders/order-1/token',
        method: 'POST',
        status: 409,
        response: { error: 'Add at least one garment before generating a customer link' },
      },
    ]);
    renderPanel({ hasActiveToken: false });

    await user.click(screen.getByRole('button', { name: /generate link/i }));

    expect(await screen.findByText(/add at least one garment before generating a customer link/i)).toBeInTheDocument();
  });

  it('copies the url to the clipboard when Copy is clicked', async () => {
    const user = userEvent.setup();
    // user-event installs its own navigator.clipboard stub during setup(), so ours
    // must be defined after that (and after render, which also runs before the
    // click) or user-event's stub silently wins.
    const writeText = vi.fn().mockResolvedValue(undefined);
    installMockFetch([
      {
        match: '/api/admin/orders/order-1/token',
        method: 'POST',
        response: { token: 'raw-token', url: 'http://localhost/o/raw-token' },
      },
    ]);
    renderPanel({ hasActiveToken: false });

    await user.click(screen.getByRole('button', { name: /generate link/i }));
    await screen.findByText('http://localhost/o/raw-token');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(screen.getByRole('button', { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith('http://localhost/o/raw-token');
  });
});
