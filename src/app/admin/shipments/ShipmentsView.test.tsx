import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';

vi.mock('@/lib/api-fetch', () => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  patchJson: vi.fn(),
  deleteJson: vi.fn(),
}));

import { getJson, postJson, patchJson } from '@/lib/api-fetch';
import { ShipmentsView, type ShipmentRow } from './ShipmentsView';

function shipmentRow(overrides: Partial<ShipmentRow> = {}): ShipmentRow {
  return {
    id: 'ship-1abc2def',
    supplierId: 'sup-1',
    nickname: 'July air freight',
    carrier: 'DHL',
    trackingNumber: 'DHL123',
    trackingUrl: 'https://track.dhl.example/DHL123',
    boxCount: 3,
    pieceCount: 41,
    shippingCost: '420.50',
    shippingCostCurrency: 'USD',
    etaDate: '2026-08-15',
    shippedAt: null,
    deliveredAt: null,
    status: 'pending',
    notes: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    supplierName: 'Vast Apparel',
    poCount: 2,
    poNumbers: ['PO-2607-VA01-JANE', 'PO-2607-VA02-JANE'],
    ...overrides,
  };
}

/** The detail shape the mutation endpoints return (toRow input). */
function detailFor(row: ShipmentRow) {
  const { supplierName, poCount, poNumbers, ...rest } = row;
  void poCount;
  return {
    ...rest,
    supplier: { id: row.supplierId, name: supplierName },
    purchaseOrders: poNumbers.map((poNumber, i) => ({
      id: `po-${i}`,
      poNumber,
      status: 'sent',
      orderId: `ord-${i}`,
      orderNumber: `BM-${i}`,
    })),
  };
}

const SUPPLIERS = [{ id: 'sup-1', name: 'Fabrico Ltd' }];
const SUPPLIER_POS = [
  { id: 'po-1', poNumber: 'PO-2607-FB01-JANE', status: 'sent', orderNumber: 'BM-1', customerName: 'Jane Coach' },
  // Already travelling — must be filtered OUT of the create modal.
  { id: 'po-2', poNumber: 'PO-2607-FB02-ROVERS', status: 'received', orderNumber: 'BM-2', customerName: 'Rovers FC' },
];

function mockGets(shipments: ShipmentRow[]) {
  vi.mocked(getJson).mockImplementation(async (url: string) => {
    if (url === '/api/admin/shipments') return shipments;
    if (url === '/api/admin/suppliers?active=1') return SUPPLIERS;
    if (url === '/api/admin/purchase-orders?supplierId=sup-1') return SUPPLIER_POS;
    throw new Error(`Unexpected getJson url: ${url}`);
  });
}

function renderView(shipments: ShipmentRow[]) {
  mockGets(shipments);
  return render(
    <AntdApp>
      <ShipmentsView />
    </AntdApp>,
  );
}

async function rowFor(text: string) {
  return (await screen.findByText(text)).closest('tr') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ShipmentsView', () => {
  it('renders a row with supplier, carrier + tracking link, PO numbers, counts, cost, ETA and status badge', async () => {
    renderView([shipmentRow()]);

    const row = await rowFor('July air freight');
    expect(getJson).toHaveBeenCalledWith('/api/admin/shipments', 'Failed to load shipments');

    expect(within(row).getByText('Vast Apparel')).toBeInTheDocument();
    expect(within(row).getByText('DHL')).toBeInTheDocument();
    const link = within(row).getByRole('link', { name: 'DHL123' });
    expect(link).toHaveAttribute('href', 'https://track.dhl.example/DHL123');
    expect(within(row).getByText('PO-2607-VA01-JANE')).toBeInTheDocument();
    expect(within(row).getByText('PO-2607-VA02-JANE')).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument(); // PO count
    expect(within(row).getByText('3 / 41')).toBeInTheDocument();
    expect(within(row).getByText('420.50 USD')).toBeInTheDocument();
    expect(within(row).getByText('15 Aug 2026')).toBeInTheDocument();
    expect(within(row).getByText('Pending')).toBeInTheDocument();
  });

  it('falls back to "Shipment {id-prefix}" when there is no nickname', async () => {
    renderView([shipmentRow({ nickname: null })]);
    expect(await screen.findByText('Shipment ship-1ab')).toBeInTheDocument();
  });

  it('creates a shipment: supplier pick loads that supplier\'s unshipped POs and posts the right body', async () => {
    const user = userEvent.setup();
    renderView([]);
    await vi.waitFor(() =>
      expect(getJson).toHaveBeenCalledWith('/api/admin/suppliers?active=1', 'Failed to load suppliers'),
    );

    await user.click(screen.getByRole('button', { name: /new shipment/i }));
    const dialog = await screen.findByRole('dialog');

    // Pick the supplier — triggers the PO fetch for that supplier.
    const combos = within(dialog).getAllByRole('combobox');
    await user.click(combos[0]);
    await user.click(await screen.findByText('Fabrico Ltd'));
    await vi.waitFor(() =>
      expect(getJson).toHaveBeenCalledWith(
        '/api/admin/purchase-orders?supplierId=sup-1',
        'Failed to load purchase orders',
      ),
    );

    // Open the PO multi-select: only the unshipped PO is offered; the
    // received one is filtered out client-side.
    await user.click(within(dialog).getAllByRole('combobox')[1]);
    const unshipped = await screen.findByText('PO-2607-FB01-JANE — Jane Coach');
    expect(screen.queryByText('PO-2607-FB02-ROVERS — Rovers FC')).not.toBeInTheDocument();
    await user.click(unshipped);

    await user.type(within(dialog).getByPlaceholderText('e.g. DHL'), 'FedEx');
    await user.type(within(dialog).getByPlaceholderText('e.g. July air freight'), 'Winter drop');

    vi.mocked(postJson).mockResolvedValueOnce(
      detailFor(
        shipmentRow({
          id: 'ship-new1',
          nickname: 'Winter drop',
          carrier: 'FedEx',
          supplierId: 'sup-1',
          supplierName: 'Fabrico Ltd',
          poNumbers: ['PO-2607-FB01-JANE'],
          poCount: 1,
        }),
      ),
    );
    await user.click(within(dialog).getByRole('button', { name: /create/i }));

    await vi.waitFor(() =>
      expect(postJson).toHaveBeenCalledWith(
        '/api/admin/shipments',
        // Empty optional fields are omitted, not sent as null.
        {
          supplierId: 'sup-1',
          purchaseOrderIds: ['po-1'],
          nickname: 'Winter drop',
          carrier: 'FedEx',
          shippingCostCurrency: 'USD',
        },
        'Failed to create shipment',
      ),
    );
    expect(await screen.findByText('Shipment created')).toBeInTheDocument();
    expect(await screen.findByText('Winter drop')).toBeInTheDocument();
  });

  it('offers only the legal next statuses for a pending row and posts the chosen transition', async () => {
    const user = userEvent.setup();
    renderView([shipmentRow()]);

    const row = await rowFor('July air freight');
    await user.click(within(row).getByRole('button', { name: /set status/i }));

    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('In transit')).toBeInTheDocument();
    expect(within(menu).getByText('Delayed')).toBeInTheDocument();
    expect(within(menu).getByText('Exception')).toBeInTheDocument();
    expect(within(menu).getByText('Cancelled')).toBeInTheDocument();
    // pending → delivered is illegal, so it is not offered.
    expect(within(menu).queryByText('Delivered')).not.toBeInTheDocument();

    vi.mocked(postJson).mockResolvedValueOnce(
      detailFor(shipmentRow({ status: 'in_transit', shippedAt: '2026-07-21T00:00:00.000Z' })),
    );
    await user.click(within(menu).getByText('In transit'));

    await vi.waitFor(() =>
      expect(postJson).toHaveBeenCalledWith(
        '/api/admin/shipments/ship-1abc2def/status',
        { status: 'in_transit' },
        'Failed to update shipment status',
      ),
    );
    // Scope to the row — the hidden dropdown menu also contains "In transit".
    await vi.waitFor(async () => {
      const updatedRow = await rowFor('July air freight');
      expect(within(updatedRow).getByText('In transit')).toBeInTheDocument();
    });
  });

  it('hides the status control entirely for terminal statuses', async () => {
    renderView([shipmentRow({ status: 'delivered', nickname: 'Done box' })]);

    const row = await rowFor('Done box');
    expect(within(row).queryByRole('button', { name: /set status/i })).not.toBeInTheDocument();
    // Field edits stay available.
    expect(within(row).getByRole('button', { name: /edit/i })).toBeInTheDocument();
  });

  it('asks for confirmation before cancelling and only posts after confirm', async () => {
    const user = userEvent.setup();
    renderView([shipmentRow()]);

    const row = await rowFor('July air freight');
    await user.click(within(row).getByRole('button', { name: /set status/i }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByText('Cancelled'));

    // Nothing posted yet — the Popconfirm gate is up.
    expect(postJson).not.toHaveBeenCalled();
    expect(await screen.findByText('Cancel this shipment?')).toBeInTheDocument();

    vi.mocked(postJson).mockResolvedValueOnce(detailFor(shipmentRow({ status: 'cancelled' })));
    await user.click(screen.getByRole('button', { name: /cancel shipment/i }));

    await vi.waitFor(() =>
      expect(postJson).toHaveBeenCalledWith(
        '/api/admin/shipments/ship-1abc2def/status',
        { status: 'cancelled' },
        'Failed to update shipment status',
      ),
    );
  });

  it('edits fields through the modal, PATCHing null for cleared values', async () => {
    const user = userEvent.setup();
    renderView([shipmentRow()]);

    const row = await rowFor('July air freight');
    await user.click(within(row).getByRole('button', { name: /edit/i }));
    const dialog = await screen.findByRole('dialog');

    const carrier = within(dialog).getByPlaceholderText('e.g. DHL');
    await user.clear(carrier);

    vi.mocked(patchJson).mockResolvedValueOnce(detailFor(shipmentRow({ carrier: null })));
    await user.click(within(dialog).getByRole('button', { name: /save/i }));

    await vi.waitFor(() =>
      expect(patchJson).toHaveBeenCalledWith(
        '/api/admin/shipments/ship-1abc2def',
        expect.objectContaining({
          nickname: 'July air freight',
          carrier: null, // cleared → null
          trackingNumber: 'DHL123',
          etaDate: '2026-08-15',
          notes: null,
        }),
        'Failed to save shipment',
      ),
    );
    expect(await screen.findByText('Shipment updated')).toBeInTheDocument();
  });
});
