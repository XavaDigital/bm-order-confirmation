import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrdersView } from './OrdersView';

const pushMock = vi.fn();
let searchParamsValue = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsValue,
}));

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNumber: 'OC-1',
    customerName: 'Jane Coach',
    customerEmail: 'jane@example.com',
    clubName: 'Wildcats',
    status: 'sent',
    orderValueAmount: '1500.00',
    orderValueCurrency: 'NZD',
    createdAt: '2026-06-01T10:00:00Z',
    confirmedAt: null,
    ...overrides,
  };
}

function mockOrdersResponse(orders: ReturnType<typeof order>[], total = orders.length) {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ orders, total }),
  } as Response);
}

function lastFetchUrl() {
  return new URL(vi.mocked(fetch).mock.calls.at(-1)![0] as string, 'http://localhost');
}

beforeEach(() => {
  pushMock.mockClear();
  searchParamsValue = new URLSearchParams();
  vi.stubGlobal('fetch', vi.fn());
});

describe('OrdersView', () => {
  it('fetches orders on mount and renders a row per order', async () => {
    mockOrdersResponse([order()], 1);
    render(<OrdersView />);

    expect(await screen.findByText('OC-1')).toBeInTheDocument();
    expect(screen.getByText('Jane Coach')).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    expect(screen.getByText('Wildcats')).toBeInTheDocument();
    expect(screen.getByText('1 order total')).toBeInTheDocument();

    const url = lastFetchUrl();
    expect(url.pathname).toBe('/api/admin/orders');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.get('offset')).toBe('0');
  });

  it('shows a colour-sample tooltip icon on the status column when a hold is active', async () => {
    mockOrdersResponse([order({ colorSampleRequestedAt: '2026-06-15T10:00:00Z' })], 1);
    render(<OrdersView />);

    expect(await screen.findByText('OC-1')).toBeInTheDocument();
    expect(screen.getByLabelText('bg-colors')).toBeInTheDocument();
  });

  it('does not show the colour-sample icon when no hold is active', async () => {
    mockOrdersResponse([order()], 1);
    render(<OrdersView />);

    expect(await screen.findByText('OC-1')).toBeInTheDocument();
    expect(screen.queryByLabelText('bg-colors')).not.toBeInTheDocument();
  });

  it('shows a dash for a missing club and formats the order value', async () => {
    mockOrdersResponse([order({ clubName: null })], 1);
    render(<OrdersView />);

    await screen.findByText('OC-1');
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText(/NZD/)).toBeInTheDocument();
  });

  it('clicking a row navigates to the order detail page', async () => {
    const user = userEvent.setup();
    mockOrdersResponse([order()], 1);
    render(<OrdersView />);

    const row = (await screen.findByText('OC-1')).closest('tr')!;
    await user.click(row);

    expect(pushMock).toHaveBeenCalledWith('/admin/orders/order-1');
  });

  it('typing in the search box debounces and refetches with the search param', async () => {
    const user = userEvent.setup();
    mockOrdersResponse([order()], 1);
    render(<OrdersView />);
    await screen.findByText('OC-1');

    mockOrdersResponse([order({ customerName: 'Bob Smith' })], 1);
    await user.type(screen.getByPlaceholderText(/search by name/i), 'Bob');

    await screen.findByText('Bob Smith', {}, { timeout: 2000 });
    const url = lastFetchUrl();
    expect(url.searchParams.get('search')).toBe('Bob');
  });

  it('switching status tabs refetches with the status filter', async () => {
    const user = userEvent.setup();
    mockOrdersResponse([order({ status: 'sent' })], 1);
    render(<OrdersView />);
    await screen.findByText('OC-1');

    mockOrdersResponse([order({ status: 'confirmed' })], 1);
    await user.click(screen.getByRole('tab', { name: 'Confirmed' }));

    await vi.waitFor(() => expect(lastFetchUrl().searchParams.get('status')).toBe('confirmed'));
  });

  it('initializes the status tab from the "status" URL search param', () => {
    searchParamsValue = new URLSearchParams('status=confirmed');
    mockOrdersResponse([], 0);
    render(<OrdersView />);

    const confirmedTab = screen.getByRole('tab', { name: 'Confirmed' });
    expect(confirmedTab).toHaveAttribute('aria-selected', 'true');
  });

  it('clicking the "Created" column header sorts and refetches with sortBy/sortDir', async () => {
    const user = userEvent.setup();
    mockOrdersResponse([order()], 1);
    render(<OrdersView />);
    await screen.findByText('OC-1');

    mockOrdersResponse([order()], 1);
    await user.click(screen.getByText('Created'));

    await vi.waitFor(() => {
      const url = lastFetchUrl();
      expect(url.searchParams.get('sortBy')).toBe('createdAt');
      expect(url.searchParams.get('sortDir')).toBe('asc');
    });
  });

  it('the Export CSV link reflects the current status filter', async () => {
    const user = userEvent.setup();
    mockOrdersResponse([order()], 1);
    render(<OrdersView />);
    await screen.findByText('OC-1');

    mockOrdersResponse([order()], 1);
    await user.click(screen.getByRole('tab', { name: 'Confirmed' }));
    await vi.waitFor(() => expect(lastFetchUrl().searchParams.get('status')).toBe('confirmed'));

    const exportLink = screen.getByRole('link', { name: /export csv/i });
    expect(exportLink).toHaveAttribute('href', '/api/admin/orders/export?status=confirmed');
  });

  it('the "New Order" link points to the new-order page', async () => {
    mockOrdersResponse([], 0);
    render(<OrdersView />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());

    expect(screen.getByRole('link', { name: /new order/i })).toHaveAttribute('href', '/admin/orders/new');
  });

  it('keeps showing the previous rows and does not crash when a refetch fails', async () => {
    const user = userEvent.setup();
    mockOrdersResponse([order()], 1);
    render(<OrdersView />);
    await screen.findByText('OC-1');

    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    await user.click(screen.getByRole('tab', { name: 'Draft' }));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.getByText('OC-1')).toBeInTheDocument();
  });
});
