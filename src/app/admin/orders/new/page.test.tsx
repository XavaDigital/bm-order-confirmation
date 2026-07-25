import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import NewOrderPage from './page';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

// The page fetches garment types on mount and CustomerHubSelect checks hub
// status — both via getJson. Stub it so those mount fetches never consume the
// global fetch mock's *Once queue that drives the submit assertions.
vi.mock('@/lib/api-fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-fetch')>();
  return { ...actual, getJson: vi.fn().mockResolvedValue([]) };
});

// The customer-details form is exercised by its own tests; stub it so this
// test drives only the create flow (garments + submit + redirect).
vi.mock('@/components/admin/orders/OrderForm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/admin/orders/OrderForm')>();
  return {
    ...actual,
    OrderForm: () => <div data-testid="order-form" />,
  };
});

function renderPage() {
  return render(
    <AntdApp>
      <NewOrderPage />
    </AntdApp>,
  );
}

beforeEach(() => {
  pushMock.mockClear();
  refreshMock.mockClear();
  vi.stubGlobal('fetch', vi.fn());
});

describe('NewOrderPage create flow', () => {
  it('a successful create navigates straight to the new order detail page', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ orderId: 'order-9', orderNumber: 'OC-9' }),
    } as Response);
    renderPage();

    await user.type(screen.getAllByPlaceholderText(/garment/i)[0], 'Home Jersey');
    await user.click(screen.getByRole('button', { name: /create order/i }));

    await vi.waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/admin/orders', expect.objectContaining({ method: 'POST' })),
    );
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/admin/orders/order-9'));
    expect(refreshMock).toHaveBeenCalled();
  });

  it('keeps the submit button disabled after success so a slow navigation cannot double-submit', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ orderId: 'order-9', orderNumber: 'OC-9' }),
    } as Response);
    renderPage();

    await user.type(screen.getAllByPlaceholderText(/garment/i)[0], 'Home Jersey');
    await user.click(screen.getByRole('button', { name: /create order/i }));

    await vi.waitFor(() => expect(pushMock).toHaveBeenCalled());
    // Navigation is in flight — clicking again must not create a second order.
    await user.click(screen.getByRole('button', { name: /create order/i }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it('a failed create shows the server error and stays on the page with the button re-enabled', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Customer email is invalid' }),
    } as Response);
    renderPage();

    await user.type(screen.getAllByPlaceholderText(/garment/i)[0], 'Home Jersey');
    await user.click(screen.getByRole('button', { name: /create order/i }));

    expect(await screen.findByText('Customer email is invalid')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: /create order/i })).toBeEnabled(),
    );
  });

  it('a success response without an orderId is treated as an error, not a silent no-op', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response);
    renderPage();

    await user.type(screen.getAllByPlaceholderText(/garment/i)[0], 'Home Jersey');
    await user.click(screen.getByRole('button', { name: /create order/i }));

    expect(await screen.findByText(/no order id was returned/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('requires at least one garment name before submitting', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /create order/i }));

    expect(await screen.findByText(/add at least one garment name/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
