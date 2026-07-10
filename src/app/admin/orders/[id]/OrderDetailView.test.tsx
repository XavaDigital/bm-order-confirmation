import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { OrderDetailView, type AdminOrderData } from './OrderDetailView';

const pushMock = vi.fn();
let searchParamsValue = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsValue,
}));

vi.mock('@/components/admin/orders/OrderForm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/admin/orders/OrderForm')>();
  return {
    ...actual,
    OrderForm: () => <div data-testid="order-form" />,
  };
});
vi.mock('@/components/admin/orders/GarmentAccordion', () => ({
  GarmentAccordion: () => <div data-testid="garment-accordion" />,
}));
vi.mock('@/components/admin/orders/ShareLinkPanel', () => ({
  ShareLinkPanel: () => <div data-testid="share-link-panel" />,
}));
vi.mock('@/components/admin/orders/AuditLogTab', () => ({
  AuditLogTab: ({ orderId }: { orderId: string }) => <div data-testid="audit-log-tab">{orderId}</div>,
}));

function baseOrder(overrides: Partial<AdminOrderData> = {}): AdminOrderData {
  return {
    id: 'order-1',
    orderNumber: 'OC-1',
    customerName: 'Jane Coach',
    customerEmail: 'jane@example.com',
    customerContact: null,
    clubName: 'Wildcats',
    orderValueAmount: '1500.00',
    orderValueCurrency: 'NZD',
    invoiceUrl: null,
    expectedShipDate: null,
    deadlineDate: null,
    generalNotes: null,
    internalNotes: null,
    shippingMode: 'later',
    status: 'sent',
    createdAt: '2026-06-01T10:00:00Z',
    updatedAt: '2026-06-01T10:00:00Z',
    confirmedAt: null,
    changesRequestedComment: null,
    changesRequestedCount: 0,
    garments: [],
    currentAccess: null,
    ...overrides,
  };
}

function renderView(order: AdminOrderData) {
  return render(
    <AntdApp>
      <OrderDetailView order={order} />
    </AntdApp>,
  );
}

beforeEach(() => {
  pushMock.mockClear();
  searchParamsValue = new URLSearchParams();
  vi.stubGlobal('fetch', vi.fn());
});

describe('OrderDetailView', () => {
  it('renders the order number, status, customer, and club in the header', () => {
    renderView(baseOrder());

    expect(screen.getByRole('heading', { name: 'OC-1' })).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByText('— Jane Coach')).toBeInTheDocument();
    expect(screen.getByText('/ Wildcats')).toBeInTheDocument();
  });

  it('shows the garments tab count and passes orderId through to the audit log tab', async () => {
    const user = userEvent.setup();
    renderView(baseOrder({ garments: [{ id: 'g-1', name: 'Jersey', fabrics: [], notes: null, sortOrder: 0, sizing: [], images: [], sizeChartIds: [] }] }));

    expect(screen.getByRole('tab', { name: 'Garments (1)' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Audit Log' }));
    expect(screen.getByTestId('audit-log-tab')).toHaveTextContent('order-1');
  });

  it('opens the tab named in the "tab" URL search param', () => {
    searchParamsValue = new URLSearchParams('tab=share');
    renderView(baseOrder());

    expect(screen.getByTestId('share-link-panel')).toBeInTheDocument();
  });

  it('shows a cancelled alert when the order is cancelled', () => {
    renderView(baseOrder({ status: 'cancelled' }));
    expect(screen.getByText('This order has been cancelled.')).toBeInTheDocument();
  });

  it('shows a confirmed alert with the confirmation date when the order is confirmed', () => {
    renderView(baseOrder({ status: 'confirmed', confirmedAt: '2026-06-15T10:00:00Z' }));
    expect(screen.getByText('This order has been confirmed by the customer.')).toBeInTheDocument();
    expect(screen.getByText(/Confirmed on/)).toBeInTheDocument();
  });

  it('shows a changes-requested alert with the round number and comment', () => {
    renderView(
      baseOrder({
        status: 'changes_requested',
        changesRequestedCount: 2,
        changesRequestedComment: 'Make it bigger',
      }),
    );
    expect(screen.getByText('Customer has requested changes (round 2).')).toBeInTheDocument();
    expect(screen.getByText(/"Make it bigger"/)).toBeInTheDocument();
  });

  it('saving details PATCHes the order and shows a success message', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
    renderView(baseOrder());

    await user.click(screen.getByRole('button', { name: /save details/i }));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/admin/orders/order-1',
      expect.objectContaining({ method: 'PATCH' }),
    ));
    expect(await screen.findByText('Order details saved')).toBeInTheDocument();
  });

  it('shows an error message when saving details fails', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    renderView(baseOrder());

    await user.click(screen.getByRole('button', { name: /save details/i }));

    expect(await screen.findByText('Failed to save order details')).toBeInTheDocument();
  });

  it('includes typed internal notes in the save payload', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
    renderView(baseOrder());

    await user.type(
      screen.getByPlaceholderText(/customer called/i),
      'Called about sizing',
    );
    await user.click(screen.getByRole('button', { name: /save details/i }));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.internalNotes).toBe('Called about sizing');
  });

  it('shows Delete order only for draft orders, and deleting redirects to the orders list', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
    renderView(baseOrder({ status: 'draft' }));

    const deleteButton = screen.getByRole('button', { name: /delete order/i });
    await user.click(deleteButton);
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(fetch).toHaveBeenCalledWith('/api/admin/orders/order-1', { method: 'DELETE' });
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/admin/orders'));
  });

  it('does not show Delete order for a non-draft order', () => {
    renderView(baseOrder({ status: 'sent' }));
    expect(screen.queryByRole('button', { name: /delete order/i })).not.toBeInTheDocument();
  });

  it('shows Resend link for a resendable status and emails a fresh link on click', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);
    renderView(baseOrder({ status: 'sent' }));

    await user.click(screen.getByRole('button', { name: /resend link/i }));

    expect(fetch).toHaveBeenCalledWith('/api/admin/orders/order-1/send-link', { method: 'POST' });
    expect(await screen.findByText('Link emailed to jane@example.com')).toBeInTheDocument();
  });

  it('shows a "not configured" message when resending on a 503 without throwing', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as Response);
    renderView(baseOrder({ status: 'sent' }));

    await user.click(screen.getByRole('button', { name: /resend link/i }));

    expect(await screen.findByText('Email delivery is not configured on this server.')).toBeInTheDocument();
  });

  it('does not show Resend link for a draft or confirmed order', () => {
    renderView(baseOrder({ status: 'draft' }));
    expect(screen.queryByRole('button', { name: /resend link/i })).not.toBeInTheDocument();
  });

  it('shows Download PDF only when the order is confirmed', () => {
    renderView(baseOrder({ status: 'confirmed' }));
    expect(screen.getByRole('link', { name: /download pdf/i })).toHaveAttribute(
      'href',
      '/api/admin/orders/order-1/pdf',
    );
  });

  it('duplicating an order POSTs and navigates to the new order', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ orderId: 'order-2', orderNumber: 'OC-2' }),
    } as Response);
    renderView(baseOrder());

    await user.click(screen.getByRole('button', { name: /duplicate/i }));

    expect(fetch).toHaveBeenCalledWith('/api/admin/orders/order-1/duplicate', { method: 'POST' });
    expect(await screen.findByText('Created OC-2 from this order')).toBeInTheDocument();
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/admin/orders/order-2'));
  });

  it('shows an error message when duplicating fails', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'No garments to copy' }),
    } as Response);
    renderView(baseOrder());

    await user.click(screen.getByRole('button', { name: /duplicate/i }));

    expect(await screen.findByText('No garments to copy')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('cancelling a cancellable order updates the status badge and hides Cancel/Resend', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
    renderView(baseOrder({ status: 'sent' }));

    await user.click(screen.getByRole('button', { name: /cancel order/i }));
    await user.click(await screen.findByRole('button', { name: 'Cancel order' }));

    expect(fetch).toHaveBeenCalledWith('/api/admin/orders/order-1/cancel', { method: 'POST' });
    expect(await screen.findByText('Order cancelled')).toBeInTheDocument();
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resend link/i })).not.toBeInTheDocument();
  });

  it('does not show Cancel order for a draft or already-cancelled order', () => {
    renderView(baseOrder({ status: 'cancelled' }));
    expect(screen.queryByRole('button', { name: /cancel order/i })).not.toBeInTheDocument();
  });

  it('shows an error message when cancelling fails, and keeps the current status', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Cannot cancel' }) } as Response);
    renderView(baseOrder({ status: 'sent' }));

    await user.click(screen.getByRole('button', { name: /cancel order/i }));
    await user.click(await screen.findByRole('button', { name: 'Cancel order' }));

    expect(await screen.findByText('Cannot cancel')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
  });
});
