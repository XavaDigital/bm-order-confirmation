import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { installMockFetch, type MockRoute } from '@/test/mockFetch';
import { ProductionPanel, type ProductionSummary } from './ProductionPanel';

const SUPPLIERS_URL = '/api/admin/suppliers?active=1';

function suppliersRoute(): MockRoute {
  return { match: SUPPLIERS_URL, method: 'GET', response: [{ id: 's1', name: 'Acme Textiles' }] };
}

function emptySummary(): ProductionSummary {
  return {
    orderId: 'order-1',
    orderNumber: 'OC-1',
    garments: [
      { id: 'g1', name: 'Jersey', sizingRowCount: 5 },
      { id: 'g2', name: 'Hoodie', sizingRowCount: 3 },
    ],
    purchaseOrders: [],
    coverage: {
      totalRows: 8,
      coveredRows: 0,
      percentage: 0,
      rowToPos: {},
      uncoveredByGarment: { g1: 5, g2: 3 },
    },
  };
}

function summaryWithPos(): ProductionSummary {
  return {
    ...emptySummary(),
    purchaseOrders: [
      {
        id: 'po-1',
        poNumber: 'PO-2607-AC01-WILDCATS',
        status: 'sent',
        currentRevisionNumber: 2,
        deadlineDate: null,
        expectedShipDate: null,
        actualShipDate: null,
        sentAt: '2026-07-01T00:00:00Z',
        receivedAt: null,
        supplier: { id: 's1', name: 'Acme Textiles' },
        latestRevision: { revisionNumber: 2, reason: 'resize', createdAt: '2026-07-02T00:00:00Z' },
        variance: { hasVariance: true },
        varianceCounts: { added: 2, modified: 1, removed: 1 },
      },
      {
        id: 'po-2',
        poNumber: 'PO-2607-AC02-WILDCATS',
        status: 'draft',
        currentRevisionNumber: 1,
        deadlineDate: null,
        expectedShipDate: null,
        actualShipDate: null,
        sentAt: null,
        receivedAt: null,
        supplier: { id: 's2', name: 'Beta Garments' },
        latestRevision: { revisionNumber: 1, reason: null, createdAt: '2026-07-03T00:00:00Z' },
        variance: { hasVariance: false },
        varianceCounts: { added: 0, modified: 0, removed: 0 },
      },
    ],
    coverage: {
      totalRows: 8,
      coveredRows: 5,
      percentage: 63,
      rowToPos: {},
      uncoveredByGarment: { g2: 3 },
    },
  };
}

function renderPanel(overrides: Partial<Parameters<typeof ProductionPanel>[0]> = {}) {
  return render(
    <AntdApp>
      <ProductionPanel
        orderId="order-1"
        orderStatus="confirmed"
        colorSampleRequestedAt={null}
        garments={[
          { id: 'g1', name: 'Jersey' },
          { id: 'g2', name: 'Hoodie' },
        ]}
        summary={emptySummary()}
        loading={false}
        error={null}
        reload={vi.fn()}
        {...overrides}
      />
    </AntdApp>,
  );
}

beforeEach(() => {
  // Default: any request throws loudly; tests install their own routes.
  installMockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProductionPanel', () => {
  it('shows the empty state when the order has no purchase orders', async () => {
    renderPanel();

    expect(await screen.findByText('No purchase orders yet for this order')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create purchase order/i })).toBeInTheDocument();
  });

  it('shows an error alert when the summary could not be loaded', async () => {
    renderPanel({ summary: null, error: 'Failed to load production summary' });

    expect(await screen.findByText('Failed to load production summary')).toBeInTheDocument();
  });

  it('shows a spinner while the summary is loading', () => {
    const { container } = renderPanel({ summary: null, loading: true });

    expect(container.querySelector('.ant-spin')).toBeTruthy();
  });

  it('renders the coverage bar with the uncovered-by-garment list', async () => {
    renderPanel({ summary: summaryWithPos() });

    expect(await screen.findByText('5 of 8 sizing rows covered')).toBeInTheDocument();
    expect(screen.getByText(/Hoodie — 3 rows uncovered/)).toBeInTheDocument();
    expect(screen.queryByText(/Jersey — .* uncovered/)).not.toBeInTheDocument();
  });

  it('renders a card per PO with number link, status badge, revision, supplier', async () => {
    renderPanel({ summary: summaryWithPos() });

    const poLink = await screen.findByRole('link', { name: 'PO-2607-AC01-WILDCATS' });
    expect(poLink).toHaveAttribute('href', '/admin/purchase-orders/po-1');
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('Acme Textiles')).toBeInTheDocument();
    expect(screen.getByText('Beta Garments')).toBeInTheDocument();
  });

  it('shows warning variance tags and a review link only for POs with variance', async () => {
    renderPanel({ summary: summaryWithPos() });

    expect(await screen.findByText('+2 added')).toBeInTheDocument();
    expect(screen.getByText('1 modified')).toBeInTheDocument();
    expect(screen.getByText('1 removed')).toBeInTheDocument();
    // Only PO 1 has variance — exactly one review link.
    const reviewLinks = screen.getAllByRole('link', { name: 'Review on PO page' });
    expect(reviewLinks).toHaveLength(1);
    expect(reviewLinks[0]).toHaveAttribute('href', '/admin/purchase-orders/po-1');
  });

  it('opens the create modal with per-garment sizing counts and covered hints', async () => {
    const user = userEvent.setup();
    // g1 fully covered, g2 has 3 uncovered rows
    installMockFetch([suppliersRoute()]);
    renderPanel({ summary: summaryWithPos() });
    await screen.findByText('5 of 8 sizing rows covered');

    await user.click(screen.getByRole('button', { name: /create purchase order/i }));

    expect(await screen.findByText('Jersey — 5 sizing rows')).toBeInTheDocument();
    expect(screen.getByText('(already covered)')).toBeInTheDocument();
    expect(screen.getByText('Hoodie — 3 sizing rows')).toBeInTheDocument();
  });

  it('asks the owner to reload after a successful create', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    installMockFetch([
      suppliersRoute(),
      {
        match: '/api/admin/purchase-orders',
        method: 'POST',
        response: { id: 'po-9', poNumber: 'PO-2607-AC01-X' },
        status: 201,
      },
    ]);
    renderPanel({ reload });
    await screen.findByText('No purchase orders yet for this order');

    await user.click(screen.getByRole('button', { name: /create purchase order/i }));
    await user.click(await screen.findByRole('combobox'));
    await user.click(await screen.findByText('Acme Textiles'));
    await user.click(screen.getByText('Jersey — 5 sizing rows'));
    // Order is confirmed with no colour-sample hold — the submit is direct.
    await user.click(screen.getByRole('button', { name: 'Create purchase order' }));

    expect(await screen.findByText('Purchase order PO-2607-AC01-X created')).toBeInTheDocument();
    // The panel doesn't own the summary — it asks OrderDetailView to refresh it.
    expect(reload).toHaveBeenCalled();
  });
});
