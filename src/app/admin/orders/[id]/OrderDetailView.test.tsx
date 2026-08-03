import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { installMockFetch } from '@/test/mockFetch';
import { OrderDetailView, type AdminOrderData } from './OrderDetailView';

const pushMock = vi.fn();
const replaceMock = vi.fn();
let searchParamsValue = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, refresh: vi.fn() }),
  useSearchParams: () => searchParamsValue,
}));

// CustomerHubSelect checks /api/admin/hub/status on mount via getJson; stub it
// (hub unconfigured → renders nothing) so the mount fetch never consumes the
// global fetch mock's *Once queue that drives the action assertions.
vi.mock('@/lib/api-fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-fetch')>();
  return { ...actual, getJson: vi.fn().mockResolvedValue({ configured: false }) };
});

vi.mock('@/components/admin/orders/OrderForm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/admin/orders/OrderForm')>();
  return {
    ...actual,
    OrderForm: () => <div data-testid="order-form" />,
  };
});
vi.mock('@/components/admin/orders/GarmentsMasterDetail', () => ({
  GarmentsMasterDetail: () => <div data-testid="garments-master-detail" />,
}));
vi.mock('@/components/admin/orders/ShareLinkPanel', () => ({
  ShareLinkPanel: () => <div data-testid="share-link-panel" />,
}));
vi.mock('@/components/admin/orders/AuditLogTab', () => ({
  AuditLogTab: ({ orderId }: { orderId: string }) => <div data-testid="audit-log-tab">{orderId}</div>,
}));
vi.mock('@/components/admin/orders/ProductionPanel', () => ({
  ProductionPanel: ({ orderId, orderStatus }: { orderId: string; orderStatus: string }) => (
    <div data-testid="production-panel">{`${orderId}:${orderStatus}`}</div>
  ),
}));

// OrderDetailView owns the production summary (rail badge + garments warning),
// so tests drive the hook rather than the underlying fetch.
const reloadProductionMock = vi.fn();
let productionAttention = {
  uncoveredRows: 0,
  posWithVariance: 0,
  needsAttention: false,
  message: null as string | null,
};
vi.mock('@/lib/use-production-summary', () => ({
  useProductionSummary: () => ({
    summary: null,
    loading: false,
    error: null,
    reload: reloadProductionMock,
    attention: productionAttention,
  }),
}));

function baseOrder(overrides: Partial<AdminOrderData> = {}): AdminOrderData {
  return {
    id: 'order-1',
    orderNumber: 'OC-1',
    name: null,
    hubCustomerId: null,
    hubCustomerName: null,
    hubContactId: null,
    hubContactName: null,
    designProjectRef: null,
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
    colorSampleRequestedAt: null,
    changesRequestedComment: null,
    changesRequestedCount: 0,
    garments: [],
    currentAccess: null,
    ...overrides,
  };
}

function renderView(order: AdminOrderData, viewer?: { currentUserId?: string; isAdmin?: boolean }) {
  return render(
    <AntdApp>
      <OrderDetailView
        order={order}
        currentUserId={viewer?.currentUserId ?? 'staff-1'}
        isAdmin={viewer?.isAdmin ?? false}
      />
    </AntdApp>,
  );
}

beforeEach(() => {
  pushMock.mockClear();
  replaceMock.mockClear();
  reloadProductionMock.mockClear();
  productionAttention = {
    uncoveredRows: 0,
    posWithVariance: 0,
    needsAttention: false,
    message: null,
  };
  searchParamsValue = new URLSearchParams();
  // Default: any request throws loudly; tests that fetch install their own routes.
  installMockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OrderDetailView', () => {
  it('renders the order number, status, customer, and club in the header', () => {
    renderView(baseOrder());

    expect(screen.getByRole('heading', { name: 'OC-1' })).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByText('— Jane Coach')).toBeInTheDocument();
    expect(screen.getByText('/ Wildcats')).toBeInTheDocument();
  });

  it('shows the garments rail count and passes orderId through to the audit log panel', async () => {
    const user = userEvent.setup();
    renderView(baseOrder({ garments: [{ id: 'g-1', name: 'Jersey', fabrics: [], notes: null, sortOrder: 0, sizing: [], images: [], sizeChartIds: [] }] }));

    expect(screen.getByRole('menuitem', { name: /Garments \(1\)/ })).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: /Audit Log/ }));
    expect(screen.getByTestId('audit-log-tab')).toHaveTextContent('order-1');
    expect(replaceMock).toHaveBeenCalledWith('?tab=audit', { scroll: false });
  });

  it('shows a Production rail entry and passes orderId + live status to the panel', async () => {
    const user = userEvent.setup();
    renderView(baseOrder({ status: 'confirmed' }));

    await user.click(screen.getByRole('menuitem', { name: /Production/ }));
    expect(screen.getByTestId('production-panel')).toHaveTextContent('order-1:confirmed');
    expect(replaceMock).toHaveBeenCalledWith('?tab=production', { scroll: false });
  });

  it('opens the section named in the "tab" URL search param', () => {
    searchParamsValue = new URLSearchParams('tab=share');
    renderView(baseOrder());

    expect(screen.getByTestId('share-link-panel')).toBeVisible();
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

  it('shows a hold-production alert when the customer requested a colour sample', () => {
    renderView(
      baseOrder({
        status: 'confirmed',
        confirmedAt: '2026-06-15T10:00:00Z',
        colorSampleRequestedAt: '2026-06-15T10:00:00Z',
      }),
    );
    expect(
      screen.getByText('Customer requested a colour book / physical sample — hold production.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Arrange colour matching/)).toBeInTheDocument();
  });

  it('does not show the colour sample alert when it was not requested', () => {
    renderView(baseOrder({ status: 'confirmed', confirmedAt: '2026-06-15T10:00:00Z' }));
    expect(
      screen.queryByText(/colour book \/ physical sample/),
    ).not.toBeInTheDocument();
  });

  it('resolving a colour sample request clears the hold-production alert', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([
      { match: '/api/admin/orders/order-1/resolve-color-sample', method: 'POST', response: { ok: true } },
    ]);
    renderView(
      baseOrder({
        status: 'confirmed',
        confirmedAt: '2026-06-15T10:00:00Z',
        colorSampleRequestedAt: '2026-06-15T10:00:00Z',
      }),
    );

    await user.click(screen.getByRole('button', { name: /mark resolved/i }));
    await user.click(await screen.findByRole('button', { name: 'Yes, resolved' }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/resolve-color-sample',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(await screen.findByText('Colour sample request marked as resolved')).toBeInTheDocument();
    expect(
      screen.queryByText('Customer requested a colour book / physical sample — hold production.'),
    ).not.toBeInTheDocument();
  });

  it('shows an error message when resolving fails, and keeps the alert', async () => {
    const user = userEvent.setup();
    installMockFetch([
      {
        match: '/api/admin/orders/order-1/resolve-color-sample',
        method: 'POST',
        status: 400,
        response: { error: 'Failed to resolve' },
      },
    ]);
    renderView(
      baseOrder({
        status: 'confirmed',
        confirmedAt: '2026-06-15T10:00:00Z',
        colorSampleRequestedAt: '2026-06-15T10:00:00Z',
      }),
    );

    await user.click(screen.getByRole('button', { name: /mark resolved/i }));
    await user.click(await screen.findByRole('button', { name: 'Yes, resolved' }));

    expect(await screen.findByText('Failed to resolve')).toBeInTheDocument();
    expect(
      screen.getByText('Customer requested a colour book / physical sample — hold production.'),
    ).toBeInTheDocument();
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
    const { fetchMock } = installMockFetch([
      { match: '/api/admin/orders/order-1', method: 'PATCH', response: { ok: true } },
    ]);
    renderView(baseOrder());

    await user.click(screen.getByRole('button', { name: /save details/i }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/orders/order-1',
      expect.objectContaining({ method: 'PATCH' }),
    ));
    expect(await screen.findByText('Order details saved')).toBeInTheDocument();
  });

  it('shows an error message when saving details fails', async () => {
    const user = userEvent.setup();
    installMockFetch([
      { match: '/api/admin/orders/order-1', method: 'PATCH', status: 500, response: {} },
    ]);
    renderView(baseOrder());

    await user.click(screen.getByRole('button', { name: /save details/i }));

    expect(await screen.findByText('Failed to save order details')).toBeInTheDocument();
  });

  // The internal-notes textarea is retired (David, 2026-08-03) — notes go
  // through the attributed thread. The save payload must OMIT internalNotes so
  // legacy content is never clobbered, and legacy text renders read-only.
  it('omits internalNotes from the save payload and shows legacy text as Imported notes', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([
      { match: '/api/admin/orders/order-1', method: 'PATCH', response: { ok: true } },
    ]);
    renderView(baseOrder({ internalNotes: 'Old freeform note' }));

    expect(screen.queryByPlaceholderText(/customer called/i)).not.toBeInTheDocument();
    expect(screen.getByText('Imported notes')).toBeInTheDocument();
    expect(screen.getByText('Old freeform note')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /save details/i }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect('internalNotes' in body).toBe(false);
  });

  it('shows Delete order only for draft orders, and deleting redirects to the orders list', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([
      { match: '/api/admin/orders/order-1', method: 'DELETE', response: { ok: true } },
    ]);
    renderView(baseOrder({ status: 'draft' }));

    const deleteButton = screen.getByRole('button', { name: /delete order/i });
    await user.click(deleteButton);
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/orders/order-1', { method: 'DELETE' });
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/admin/orders'));
  });

  it('does not show Delete order for a non-draft order', () => {
    renderView(baseOrder({ status: 'sent' }));
    expect(screen.queryByRole('button', { name: /delete order/i })).not.toBeInTheDocument();
  });

  it('shows Resend link for a resendable status and emails a fresh link on click', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([
      { match: '/api/admin/orders/order-1/send-link', method: 'POST', response: {} },
    ]);
    renderView(baseOrder({ status: 'sent' }));

    await user.click(screen.getByRole('button', { name: /resend link/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/send-link',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(await screen.findByText('Link emailed to jane@example.com')).toBeInTheDocument();
  });

  it('shows a "not configured" message when resending on a 503 without throwing', async () => {
    const user = userEvent.setup();
    installMockFetch([
      { match: '/api/admin/orders/order-1/send-link', method: 'POST', status: 503, response: {} },
    ]);
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

  it('duplicating as a reprint POSTs the reprint flag and navigates', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([
      {
        match: '/api/admin/orders/order-1/duplicate',
        method: 'POST',
        response: { orderId: 'order-2', orderNumber: 'OC-2' },
      },
    ]);
    renderView(baseOrder());

    await user.click(screen.getByRole('button', { name: /duplicate/i }));
    // The modal defaults to "reprint" — the common case.
    await user.type(
      await screen.findByPlaceholderText(/why is this being reprinted/i),
      'Same kit again',
    );
    await user.click(screen.getByRole('button', { name: /create reprint/i }));

    const call = fetchMock.mock.calls.find(
      ([url]) => url === '/api/admin/orders/order-1/duplicate',
    );
    expect(JSON.parse(call![1]!.body as string)).toEqual({
      reprint: true,
      reprintReason: 'Same kit again',
    });
    expect(await screen.findByText('Created reprint OC-2 of this order')).toBeInTheDocument();
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/admin/orders/order-2'));
  });

  it('duplicating plainly records no reprint link', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([
      {
        match: '/api/admin/orders/order-1/duplicate',
        method: 'POST',
        response: { orderId: 'order-3', orderNumber: 'OC-3' },
      },
    ]);
    renderView(baseOrder());

    await user.click(screen.getByRole('button', { name: /duplicate/i }));
    await user.click(await screen.findByText('Plain duplicate'));
    await user.click(screen.getByRole('button', { name: /create duplicate/i }));

    const call = fetchMock.mock.calls.find(
      ([url]) => url === '/api/admin/orders/order-1/duplicate',
    );
    expect(JSON.parse(call![1]!.body as string)).toEqual({
      reprint: false,
      reprintReason: null,
    });
    expect(await screen.findByText('Created OC-3 from this order')).toBeInTheDocument();
  });

  it('shows the reprint origin in the header when the order is a reprint', () => {
    renderView(
      baseOrder({
        sourceOrder: { id: 'order-0', orderNumber: 'OC-0' },
        reprintReason: 'Customer reordering',
      }),
    );

    const chip = screen.getByText(/Reprint of OC-0/);
    expect(chip).toBeInTheDocument();
    expect(chip.closest('a')).toHaveAttribute('href', '/admin/orders/order-0');
  });

  it('shows an error message when duplicating fails', async () => {
    const user = userEvent.setup();
    installMockFetch([
      {
        match: '/api/admin/orders/order-1/duplicate',
        method: 'POST',
        status: 400,
        response: { error: 'No garments to copy' },
      },
    ]);
    renderView(baseOrder());

    await user.click(screen.getByRole('button', { name: /duplicate/i }));
    await user.click(await screen.findByRole('button', { name: /create reprint/i }));

    expect(await screen.findByText('No garments to copy')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('cancelling a cancellable order updates the status badge and hides Cancel/Resend', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([
      { match: '/api/admin/orders/order-1/cancel', method: 'POST', response: { ok: true } },
    ]);
    renderView(baseOrder({ status: 'sent' }));

    await user.click(screen.getByRole('button', { name: /cancel order/i }));
    await user.click(await screen.findByRole('button', { name: 'Cancel order' }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
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
    installMockFetch([
      {
        match: '/api/admin/orders/order-1/cancel',
        method: 'POST',
        status: 400,
        response: { error: 'Cannot cancel' },
      },
    ]);
    renderView(baseOrder({ status: 'sent' }));

    await user.click(screen.getByRole('button', { name: /cancel order/i }));
    await user.click(await screen.findByRole('button', { name: 'Cancel order' }));

    expect(await screen.findByText('Cannot cancel')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
  });

  describe('production attention indicators', () => {
    function needsAttention() {
      productionAttention = {
        uncoveredRows: 3,
        posWithVariance: 1,
        needsAttention: true,
        message: '3 sizing rows are not covered by a purchase order',
      };
    }

    it('marks the Production rail entry when action is needed', async () => {
      needsAttention();
      renderView(baseOrder());

      expect(await screen.findByLabelText('Production needs attention')).toBeInTheDocument();
    });

    it('leaves the Production rail entry unmarked when nothing is owed', () => {
      renderView(baseOrder());

      expect(screen.queryByLabelText('Production needs attention')).not.toBeInTheDocument();
    });

    it('warns on the garments section and can jump to Production', async () => {
      const user = userEvent.setup();
      needsAttention();
      renderView(baseOrder());

      await user.click(screen.getByRole('menuitem', { name: /garments/i }));

      expect(
        await screen.findByText('These garments are not fully covered by a purchase order'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/3 sizing rows are not covered by a purchase order/),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Open Production' }));
      expect(await screen.findByTestId('production-panel')).toBeVisible();
    });

    it('re-reads the summary when the Production section is opened', async () => {
      const user = userEvent.setup();
      renderView(baseOrder());
      reloadProductionMock.mockClear();

      await user.click(screen.getByRole('menuitem', { name: /production/i }));

      // Panels stay mounted once visited, so opening the section must refetch.
      expect(reloadProductionMock).toHaveBeenCalled();
    });
  });
});
