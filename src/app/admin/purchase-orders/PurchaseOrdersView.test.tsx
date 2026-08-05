import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { installMockFetch, type MockRoute } from '@/test/mockFetch';
import { PurchaseOrdersView } from './PurchaseOrdersView';

// The board view renders WorkflowBoard, whose card-click navigation calls
// useRouter — jsdom has no app router mounted, so mock it like every other
// component test here does.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function poRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'po-1',
    poNumber: 'PO-2607-VA01-JANECOACH',
    // Defaults keep the DISPLAY title equal to the poNumber (no ref, unsent)
    // so the plain-row assertions stay exact; the display-title test overrides.
    customerRef: null,
    status: 'sent',
    currentRevisionNumber: 2,
    deadlineDate: '2026-09-15',
    expectedShipDate: '2026-08-30',
    actualShipDate: null,
    sentAt: null,
    createdAt: '2026-07-18T10:00:00Z',
    orderId: 'order-1',
    orderNumber: 'BM-1042',
    customerName: 'Jane Coach',
    supplierId: 'sup-1',
    supplierName: 'Vast Apparel',
    ...overrides,
  };
}

const suppliersRoute: MockRoute = {
  match: '/api/admin/suppliers',
  method: 'GET',
  response: [{ id: 'sup-1', name: 'Vast Apparel' }],
};

function posRoute(rows: ReturnType<typeof poRow>[]): MockRoute {
  return { match: /\/api\/admin\/purchase-orders/, method: 'GET', response: rows };
}

/**
 * These tests are about the TABLE, so they open on it directly — the page
 * itself lands on the board, which is covered by the toggle test at the bottom.
 */
function renderView() {
  return render(
    <AntdApp>
      <PurchaseOrdersView initialView="table" />
    </AntdApp>,
  );
}

beforeEach(() => {
  installMockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PurchaseOrdersView', () => {
  it('fetches and renders a row with PO/order links, supplier, status, revision and dates', async () => {
    installMockFetch([suppliersRoute, posRoute([poRow()])]);
    renderView();

    expect(await screen.findByText('PO-2607-VA01-JANECOACH')).toBeInTheDocument();
    expect(screen.getByText('BM-1042')).toBeInTheDocument();
    expect(screen.getByText('Jane Coach')).toBeInTheDocument();
    expect(screen.getByText('Vast Apparel')).toBeInTheDocument();
    // 'sent' renders as Unconfirmed (poStatusMeta).
    expect(screen.getByText('Unconfirmed')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByText('15 Sept 2026')).toBeInTheDocument();
    expect(screen.getByText('30 Aug 2026')).toBeInTheDocument();

    expect(screen.getByText('PO-2607-VA01-JANECOACH').closest('a')).toHaveAttribute(
      'href',
      '/admin/purchase-orders/po-1',
    );
    expect(screen.getByText('BM-1042').closest('a')).toHaveAttribute(
      'href',
      '/admin/orders/order-1',
    );
  });

  it('leads with the display title and keeps the canonical poNumber beneath when they differ', async () => {
    installMockFetch([
      suppliersRoute,
      posRoute([
        poRow({ poNumber: 'VA1', customerRef: 'Jane Coach', sentAt: '2026-07-20T10:00:00Z' }),
      ]),
    ]);
    renderView();

    // YYMM of the send date + poNumber + normalised customer ref.
    const title = await screen.findByText('2607-VA1-JANE-COACH');
    expect(title.closest('a')).toHaveAttribute('href', '/admin/purchase-orders/po-1');
    // The canonical number stays visible beneath the display title.
    expect(screen.getByText('VA1')).toBeInTheDocument();
  });

  it('shows the empty message when there are no purchase orders', async () => {
    installMockFetch([suppliersRoute, posRoute([])]);
    renderView();

    expect(await screen.findByText(/no purchase orders yet/i)).toBeInTheDocument();
  });

  it('refetches with a search param after typing (debounced)', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([suppliersRoute, posRoute([poRow()])]);
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    await user.type(screen.getByPlaceholderText(/search po, order/i), 'jane');

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/purchase-orders?search=jane');
    });
  });

  it('refetches with a status param when a status filter is picked', async () => {
    const { fetchMock } = installMockFetch([suppliersRoute, posRoute([poRow()])]);
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    // First combobox is the status Select; antd opens on mouseDown.
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
    fireEvent.click(await screen.findByTitle('Production'));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/purchase-orders?status=in_production');
    });
  });

  it('refetches with a supplierId param when a supplier filter is picked', async () => {
    const { fetchMock } = installMockFetch([suppliersRoute, posRoute([poRow()])]);
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    fireEvent.mouseDown(screen.getAllByRole('combobox')[1]);
    fireEvent.click(await screen.findByTitle('Vast Apparel'));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/purchase-orders?supplierId=sup-1');
    });
  });
});

describe('PurchaseOrdersView — view toggle', () => {
  const boardRoute: MockRoute = {
    match: /\/api\/admin\/workflow\/board/,
    method: 'GET',
    response: { boardKey: 'purchase_order', orphanedCount: 0, columns: [] },
  };

  it('opens on the board, and reveals the table when switched', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([boardRoute, suppliersRoute, posRoute([poRow()])]);

    render(
      <AntdApp>
        <PurchaseOrdersView />
      </AntdApp>,
    );

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/workflow/board?boardKey=purchase_order'),
      ),
    );
    // The table and its filters are not rendered underneath.
    expect(screen.queryByPlaceholderText(/search po/i)).not.toBeInTheDocument();

    // antd's Segmented radio carries pointer-events:none, so click the label.
    await user.click(screen.getByText('Table'));

    expect(await screen.findByPlaceholderText(/search po/i)).toBeInTheDocument();
  });
});
