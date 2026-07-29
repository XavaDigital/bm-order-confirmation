import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { installMockFetch, type MockRoute } from '@/test/mockFetch';
import { PoDetailView } from './PoDetailView';

const PO_ID = 'po-1';

function snapshot() {
  return {
    orderNumber: 'BM-1042',
    garments: [
      {
        garmentId: 'g1',
        name: 'Team Hoodie',
        garmentTypeId: null,
        garmentTypeName: 'Hoodie',
        fabrics: [],
        selectedFabrics: null,
        selectedOptions: null,
        notes: null,
        lines: [
          { sizingRowId: 'row-1', size: 'M', playerName: 'Alice', playerNumber: '7', notes: null },
          { sizingRowId: 'row-2', size: 'M', playerName: 'Bob', playerNumber: null, notes: null },
          { sizingRowId: 'row-3', size: 'L', playerName: null, playerNumber: null, notes: null },
        ],
      },
    ],
  };
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: PO_ID,
    poNumber: 'PO-2607-VA01-JANECOACH',
    orderId: 'order-1',
    status: 'sent',
    currentRevisionNumber: 1,
    deadlineDate: '2026-09-15',
    expectedShipDate: null,
    actualShipDate: null,
    sentAt: '2026-07-20T10:00:00Z',
    receivedAt: null,
    notes: null,
    createdAt: '2026-07-18T10:00:00Z',
    supplier: {
      id: 'sup-1',
      name: 'Vast Apparel',
      contactPerson: 'Li Wei',
      email: 'factory@example.com',
      phone: null,
    },
    order: { id: 'order-1', orderNumber: 'BM-1042', customerName: 'Jane Coach', status: 'confirmed' },
    revisions: [
      {
        id: 'rev-1',
        revisionNumber: 1,
        reason: null,
        snapshot: snapshot(),
        createdAt: '2026-07-18T10:00:00Z',
      },
    ],
    shipments: [],
    supplierLink: { active: false, lastViewedAt: null },
    ...overrides,
  };
}

function noVarianceSummary() {
  return {
    purchaseOrders: [
      {
        id: PO_ID,
        variance: { garments: [], hasVariance: false },
        varianceCounts: { added: 0, modified: 0, removed: 0 },
      },
    ],
  };
}

function varianceSummary() {
  return {
    purchaseOrders: [
      {
        id: PO_ID,
        variance: {
          hasVariance: true,
          garments: [
            {
              garmentId: 'g1',
              name: 'Team Hoodie',
              status: 'modified',
              fieldChanges: [],
              lines: [
                {
                  sizingRowId: 'row-4',
                  change: 'added',
                  line: { sizingRowId: 'row-4', size: 'XL', playerName: 'Zoe', playerNumber: null, notes: null },
                },
                {
                  sizingRowId: 'row-1',
                  change: 'modified',
                  fieldChanges: [{ field: 'size', from: 'M', to: 'S' }],
                  line: { sizingRowId: 'row-1', size: 'S', playerName: 'Alice', playerNumber: '7', notes: null },
                },
              ],
            },
          ],
        },
        varianceCounts: { added: 1, modified: 1, removed: 0 },
      },
    ],
  };
}

function baseRoutes(d = detail(), summary: unknown = noVarianceSummary()): MockRoute[] {
  return [
    { match: `/api/admin/purchase-orders/${PO_ID}`, method: 'GET', response: d },
    { match: /\/api\/admin\/orders\/order-1\/purchase-orders/, method: 'GET', response: summary },
  ];
}

function renderView() {
  return render(
    <AntdApp>
      <PoDetailView poId={PO_ID} />
    </AntdApp>,
  );
}

beforeEach(() => {
  installMockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PoDetailView', () => {
  it('renders the header with PO number, status badge, revision tag and actions', async () => {
    installMockFetch(baseRoutes());
    renderView();

    expect(await screen.findByText('PO-2607-VA01-JANECOACH')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();

    const sendButton = screen.getByRole('button', { name: /send to supplier/i });
    expect(sendButton).toBeEnabled();
    const pdfLink = screen.getByRole('button', { name: /download pdf/i }).closest('a');
    expect(pdfLink).toHaveAttribute('href', `/api/admin/purchase-orders/${PO_ID}/pdf`);
    expect(screen.getByRole('button', { name: /advance status/i })).toBeInTheDocument();
  });

  it('offers ONLY the legal status transitions in the Advance status dropdown', async () => {
    const user = userEvent.setup();
    installMockFetch(baseRoutes());
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    await user.click(screen.getByRole('button', { name: /advance status/i }));

    const menu = await screen.findByRole('menu');
    // From 'sent': forward chain + cancel...
    for (const label of [
      'Confirmed',
      'Pre-production',
      'In production',
      'In transit',
      'Received',
      'Completed',
      'Cancelled',
    ]) {
      expect(within(menu).getByText(label)).toBeInTheDocument();
    }
    // ...but never backwards or into remake from 'sent'.
    expect(within(menu).queryByText('Draft')).not.toBeInTheDocument();
    expect(within(menu).queryByText('Remake')).not.toBeInTheDocument();
  });

  it('posts a legal transition and reloads', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch(baseRoutes());
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/status`,
      method: 'POST',
      response: { ok: true },
    });
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    await user.click(screen.getByRole('button', { name: /advance status/i }));
    await user.click(await screen.findByText('In production'));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/admin/purchase-orders/${PO_ID}/status`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ status: 'in_production' }),
        }),
      );
    });
  });

  it('disables Send to supplier when the supplier has no email address', async () => {
    installMockFetch(
      baseRoutes(detail({ supplier: { id: 'sup-1', name: 'Vast Apparel', contactPerson: null, email: null, phone: null } })),
    );
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    expect(screen.getByRole('button', { name: /send to supplier/i })).toBeDisabled();
  });

  it('sends to the supplier through the Popconfirm and surfaces the response', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch(baseRoutes());
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/send`,
      method: 'POST',
      response: { ok: true, poNumber: 'PO-2607-VA01-JANECOACH', to: 'factory@example.com' },
    });
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    await user.click(screen.getByRole('button', { name: /send to supplier/i }));
    await user.click(await screen.findByRole('button', { name: 'Send' }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/admin/purchase-orders/${PO_ID}/send`,
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(await screen.findByText(/emailed to factory@example.com/i)).toBeInTheDocument();
  });

  it('surfaces the 503 email-unconfigured message on send', async () => {
    const user = userEvent.setup();
    const { addRoute } = installMockFetch(baseRoutes());
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/send`,
      method: 'POST',
      status: 503,
      response: { error: 'Email delivery is not configured on this server.' },
    });
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    await user.click(screen.getByRole('button', { name: /send to supplier/i }));
    await user.click(await screen.findByRole('button', { name: 'Send' }));

    expect(
      await screen.findByText('Email delivery is not configured on this server.'),
    ).toBeInTheDocument();
  });

  it('shows the variance banner with counts and the expandable diff', async () => {
    const user = userEvent.setup();
    installMockFetch(baseRoutes(detail(), varianceSummary()));
    renderView();

    expect(
      await screen.findByText(
        'Order has changed since revision 1 — 1 added / 1 modified / 0 removed',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByText('View differences'));
    expect(await screen.findByText('Added')).toBeInTheDocument();
    expect(screen.getByText(/XL · Zoe/)).toBeInTheDocument();
    expect(screen.getByText(/size: M → S/)).toBeInTheDocument();
  });

  it('does not show the variance banner when the live order matches the snapshot', async () => {
    installMockFetch(baseRoutes());
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    expect(screen.queryByText(/order has changed since revision/i)).not.toBeInTheDocument();
  });

  it('issues a revision with a required reason from the banner modal', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch(baseRoutes(detail(), varianceSummary()));
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/revisions`,
      method: 'POST',
      response: { id: 'rev-2', revisionNumber: 2, reason: 'sizes corrected' },
    });
    renderView();
    await screen.findByText(/order has changed since revision 1/i);

    await user.click(screen.getByRole('button', { name: /issue revision/i }));
    const dialog = await screen.findByRole('dialog');

    // Empty reason is rejected client-side.
    await user.click(within(dialog).getByRole('button', { name: /issue revision/i }));
    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/admin/purchase-orders/${PO_ID}/revisions`,
      expect.anything(),
    );

    await user.type(within(dialog).getByRole('textbox'), 'sizes corrected');
    await user.click(within(dialog).getByRole('button', { name: /issue revision/i }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/admin/purchase-orders/${PO_ID}/revisions`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ reason: 'sizes corrected' }),
        }),
      );
    });
  });

  it('renders the latest-revision lines with per-garment size strips and the grand total', async () => {
    installMockFetch(baseRoutes());
    renderView();

    expect(await screen.findByText('Team Hoodie')).toBeInTheDocument();
    expect(screen.getByText('Hoodie')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('M ×2 · L ×1 — 3 pieces')).toBeInTheDocument();
    expect(screen.getByText('3 pieces total')).toBeInTheDocument();
  });

  it('renders the revision history timeline with per-revision PDF links', async () => {
    installMockFetch(
      baseRoutes(
        detail({
          currentRevisionNumber: 2,
          revisions: [
            {
              id: 'rev-2',
              revisionNumber: 2,
              reason: 'sizes corrected',
              snapshot: snapshot(),
              createdAt: '2026-07-22T10:00:00Z',
            },
            {
              id: 'rev-1',
              revisionNumber: 1,
              reason: null,
              snapshot: snapshot(),
              createdAt: '2026-07-18T10:00:00Z',
            },
          ],
        }),
      ),
    );
    renderView();

    expect(await screen.findByText('Revision 2')).toBeInTheDocument();
    expect(screen.getByText(/sizes corrected/)).toBeInTheDocument();
    expect(screen.getByText(/— Original —/)).toBeInTheDocument();
    expect(screen.getByLabelText('PDF for revision 2')).toHaveAttribute(
      'href',
      `/api/admin/purchase-orders/${PO_ID}/pdf?rev=2`,
    );
    expect(screen.getByLabelText('PDF for revision 1')).toHaveAttribute(
      'href',
      `/api/admin/purchase-orders/${PO_ID}/pdf?rev=1`,
    );
  });

  it('renders the shipments placeholder when no shipments are attached', async () => {
    installMockFetch(baseRoutes());
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    expect(screen.getByText(/shipment management arrives with the shipments page/i)).toBeInTheDocument();
  });

  it('lists attached shipments with their status badge', async () => {
    installMockFetch(
      baseRoutes(
        detail({
          shipments: [
            { id: 'ship-1', nickname: 'July air batch', carrier: 'DHL', trackingNumber: null, status: 'in_transit' },
          ],
        }),
      ),
    );
    renderView();

    expect(await screen.findByText('July air batch')).toBeInTheDocument();
    expect(screen.getByText('DHL')).toBeInTheDocument();
    expect(screen.getByText('In transit')).toBeInTheDocument();
  });
});
