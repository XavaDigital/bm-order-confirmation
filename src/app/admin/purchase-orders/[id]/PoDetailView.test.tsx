import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
    colorBookId: null,
    colorBookName: null,
    supplier: {
      id: 'sup-1',
      name: 'Vast Apparel',
      contactPerson: 'Li Wei',
      email: 'factory@example.com',
      phone: null,
    },
    order: {
      id: 'order-1',
      orderNumber: 'BM-1042',
      customerName: 'Jane Coach',
      status: 'confirmed',
      deadlineDate: '2026-09-15',
    },
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
    portalUrl: 'https://orders.example.com/supplier/VA/PO-2607-VA01-JANECOACH',
    history: [],
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

function baseRoutes(
  d = detail(),
  summary: unknown = noVarianceSummary(),
  opts: { portalPassword?: string | null; comments?: unknown[]; orderNotes?: unknown[] } = {},
): MockRoute[] {
  return [
    { match: `/api/admin/purchase-orders/${PO_ID}`, method: 'GET', response: d },
    // The production-files card fetches on mount.
    {
      match: `/api/admin/purchase-orders/${PO_ID}/files`,
      method: 'GET',
      response: { items: [] },
    },
    { match: /\/api\/admin\/orders\/order-1\/purchase-orders/, method: 'GET', response: summary },
    {
      match: '/api/admin/suppliers/sup-1',
      method: 'GET',
      // `in` rather than `??` — an explicit null (portal closed) must survive.
      response: {
        id: 'sup-1',
        portalPassword: 'portalPassword' in opts ? opts.portalPassword : 'hunter22',
      },
    },
    {
      match: '/api/admin/orders/order-1/notes',
      method: 'GET',
      response: opts.comments ?? [],
    },
    {
      match: '/api/admin/orders/order-1/notes?kind=note',
      method: 'GET',
      response: opts.orderNotes ?? [],
    },
  ];
}

function note(overrides: Record<string, unknown> = {}) {
  return {
    id: 'note-1',
    body: 'Please double-box the hoodies',
    authorKind: 'staff',
    authorName: 'Dana Sales',
    authorEmail: 'dana@example.com',
    authorLabel: null,
    visibility: 'shared',
    deleted: false,
    createdAt: '2026-07-21T10:00:00Z',
    ...overrides,
  };
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
    // 'sent' renders as Unconfirmed (poStatusMeta).
    expect(screen.getByText('Unconfirmed')).toBeInTheDocument();
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
    // From 'sent': the full forward production chain + cancel...
    for (const label of [
      'Confirmed',
      'Design prep',
      'Test print',
      'Prod layout',
      'Production',
      'Quality control',
      'Shipping',
      'Received',
      'Completed',
      'Cancelled',
    ]) {
      expect(within(menu).getByText(label)).toBeInTheDocument();
    }
    // ...but never backwards or into remake from 'sent'.
    expect(within(menu).queryByText('Draft')).not.toBeInTheDocument();
    expect(within(menu).queryByText('Approved')).not.toBeInTheDocument();
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
    await user.click(await screen.findByText('Production'));

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
      response: {
        ok: true,
        poNumber: 'PO-2607-VA01-JANECOACH',
        to: 'factory@example.com',
        attachmentSummary: { images: 2, fonts: 1, sizeCharts: 1, sizeReduced: false },
      },
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

  it('shows the customer deadline read-only, sourced from the order', async () => {
    installMockFetch(baseRoutes());
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    expect(screen.getByText('Customer deadline')).toBeInTheDocument();
    // en-NZ short month renders "Sep" or "Sept" depending on ICU.
    expect(screen.getByText(/15 Sept? 2026/)).toBeInTheDocument();
    // The per-PO deadline picker is gone.
    expect(screen.queryByText('Deadline')).not.toBeInTheDocument();
  });

  it('saves ship dates and notes WITHOUT a deadlineDate', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch(baseRoutes());
    addRoute({ match: `/api/admin/purchase-orders/${PO_ID}`, method: 'PATCH', response: detail() });
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch?.[0]).toBe(`/api/admin/purchase-orders/${PO_ID}`);
      expect(JSON.parse(patch![1]!.body as string)).toEqual({
        expectedShipDate: null,
        actualShipDate: null,
        notes: null,
      });
    });
  });

  it('shows Approve for a draft PO and blocks sending until approved', async () => {
    installMockFetch(baseRoutes(detail({ status: 'draft' })));
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send to supplier/i })).toBeDisabled();
  });

  it('Approve posts the approved status', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch(baseRoutes(detail({ status: 'draft' })));
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/status`,
      method: 'POST',
      response: { ok: true },
    });
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    await user.click(screen.getByRole('button', { name: /approve/i }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/admin/purchase-orders/${PO_ID}/status`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ status: 'approved' }),
        }),
      );
    });
  });

  it('always shows the portal URL with Open and the copy link + password snippet', async () => {
    installMockFetch(baseRoutes());
    renderView();

    expect(
      await screen.findByText('https://orders.example.com/supplier/VA/PO-2607-VA01-JANECOACH'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open/i })).toHaveAttribute(
      'href',
      'https://orders.example.com/supplier/VA/PO-2607-VA01-JANECOACH',
    );
    expect(
      await screen.findByRole('button', { name: /copy link \+ password/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Portal password: hunter22/)).toBeInTheDocument();
    // The token generate/revoke flow is gone.
    expect(screen.queryByRole('button', { name: /generate link/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revoke link/i })).not.toBeInTheDocument();
  });

  it('warns that the portal is closed when the supplier has no password', async () => {
    installMockFetch(baseRoutes(detail(), noVarianceSummary(), { portalPassword: null }));
    renderView();

    expect(await screen.findByText('The supplier portal is closed')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /copy link \+ password/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /supplier record/i })).toHaveAttribute(
      'href',
      '/admin/suppliers',
    );
  });

  it('shows when the legacy emailed link was last opened', async () => {
    installMockFetch(
      baseRoutes(detail({ supplierLink: { active: true, lastViewedAt: '2026-07-25T10:00:00Z' } })),
    );
    renderView();

    expect(await screen.findByText(/legacy emailed link last opened/i)).toBeInTheDocument();
  });

  it('renders the history card with plain labels, actors and from→to', async () => {
    installMockFetch(
      baseRoutes(
        detail({
          history: [
            {
              id: 'h2',
              eventType: 'po.status_changed',
              actorEmail: 'sam@example.com',
              payload: { poId: PO_ID, from: 'approved', to: 'sent' },
              createdAt: '2026-07-20T10:00:00Z',
            },
            {
              id: 'h1',
              eventType: 'po.created',
              actorEmail: 'sam@example.com',
              payload: { poId: PO_ID },
              createdAt: '2026-07-18T10:00:00Z',
            },
          ],
        }),
      ),
    );
    renderView();

    expect(await screen.findByText('Status changed')).toBeInTheDocument();
    // Statuses render their display labels, not the raw keys.
    expect(screen.getByText('Approved → Unconfirmed')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getAllByText('sam@example.com')).toHaveLength(2);
  });

  it('shows only SHARED comments in the supplier conversation', async () => {
    installMockFetch(
      baseRoutes(detail(), noVarianceSummary(), {
        comments: [
          note(),
          note({ id: 'note-2', body: 'internal grumbling', visibility: 'internal' }),
          note({
            id: 'note-3',
            body: 'We will ship Friday',
            authorKind: 'supplier',
            authorName: null,
            authorEmail: null,
            authorLabel: 'Factory rep',
          }),
        ],
      }),
    );
    renderView();

    expect(await screen.findByText('Please double-box the hoodies')).toBeInTheDocument();
    expect(screen.getByText('We will ship Friday')).toBeInTheDocument();
    expect(screen.getByText('Factory rep')).toBeInTheDocument();
    expect(screen.queryByText('internal grumbling')).not.toBeInTheDocument();
  });

  it('posts a staff reply as a shared note', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch(baseRoutes());
    addRoute({
      match: '/api/admin/orders/order-1/notes',
      method: 'POST',
      status: 201,
      response: { id: 'note-9' },
    });
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    await user.type(screen.getByLabelText('New supplier comment'), 'Thanks, confirmed');
    await user.click(screen.getByRole('button', { name: /post to supplier/i }));

    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post?.[0]).toBe('/api/admin/orders/order-1/notes');
      expect(JSON.parse(post![1]!.body as string)).toEqual({
        body: 'Thanks, confirmed',
        visibility: 'shared',
      });
    });
  });

  it('brings the team order notes through read-only', async () => {
    installMockFetch(
      baseRoutes(detail(), noVarianceSummary(), {
        orderNotes: [note({ id: 'n1', body: 'Sleeves 1cm shorter', visibility: 'internal' })],
      }),
    );
    renderView();

    expect(await screen.findByText('Order notes (from the order)')).toBeInTheDocument();
    expect(await screen.findByText('Sleeves 1cm shorter')).toBeInTheDocument();
  });

  it('renders per-garment options, fabrics, size charts, images and custom sizing columns', async () => {
    const snap = snapshot();
    snap.garments[0] = {
      ...snap.garments[0],
      fabrics: ['Dri-fit'],
      selectedFabrics: { Body: 'Dri-fit' },
      selectedOptions: { Collar: 'V-neck' },
      sizingColumns: [{ label: 'Initials', type: 'text' }],
      sizeCharts: [{ id: 'sc1', name: 'Adult hoodie chart', storageKey: 'charts/x.png' }],
      images: [
        { id: 'img1', storageKey: 'mockups/a.png', thumbnailStorageKey: null, caption: 'Front' },
        { id: 'img2', storageKey: 'mockups/b.png', thumbnailStorageKey: null, caption: null },
      ],
      lines: [
        {
          sizingRowId: 'row-1',
          size: 'M',
          playerName: 'Alice',
          playerNumber: '7',
          notes: null,
          customValues: { Initials: 'AB' },
          quantity: 2,
        },
      ],
    } as unknown as (typeof snap.garments)[0];
    installMockFetch(
      baseRoutes(
        detail({
          revisions: [
            {
              id: 'rev-1',
              revisionNumber: 1,
              reason: null,
              snapshot: snap,
              createdAt: '2026-07-18T10:00:00Z',
            },
          ],
        }),
      ),
    );
    renderView();

    expect(await screen.findByText(/Body: Dri-fit/)).toBeInTheDocument();
    expect(screen.getByText(/Collar: V-neck/)).toBeInTheDocument();
    expect(screen.getByText('Adult hoodie chart')).toBeInTheDocument();
    expect(screen.getByText(/2 mock-up images on the supplier PO — Front/)).toBeInTheDocument();
    // The snapshot's custom sizing column drives a real table column.
    expect(screen.getByText('Initials')).toBeInTheDocument();
    expect(screen.getByText('AB')).toBeInTheDocument();
    expect(screen.getByText('Qty')).toBeInTheDocument();
  });

  it('shows "Colour book: None" with an Edit affordance when no book is set', async () => {
    installMockFetch(baseRoutes());
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    expect(screen.getByText('Colour book:')).toBeInTheDocument();
    expect(screen.getByText('None')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit colour book' })).toBeInTheDocument();
  });

  it('shows the PO colour book name in the summary', async () => {
    installMockFetch(
      baseRoutes(detail({ colorBookId: 'cb-old', colorBookName: 'Pantone 2024' })),
    );
    renderView();

    expect(await screen.findByText('Pantone 2024')).toBeInTheDocument();
    expect(screen.queryByText('None')).not.toBeInTheDocument();
  });

  it('edits the colour book from the supplier book list and PATCHes colorBookId', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch(
      baseRoutes(detail({ colorBookId: 'cb-old', colorBookName: 'Pantone 2024' })),
    );
    addRoute({
      match: '/api/admin/suppliers/sup-1/color-books',
      method: 'GET',
      response: {
        items: [
          { id: 'cb-new', name: 'Pantone 2026', createdAt: '2026-08-01T00:00:00Z' },
          { id: 'cb-old', name: 'Pantone 2024', createdAt: '2024-08-01T00:00:00Z' },
        ],
      },
    });
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}`,
      method: 'PATCH',
      response: { ok: true },
    });
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    await user.click(screen.getByRole('button', { name: 'Edit colour book' }));
    await user.click(await screen.findByRole('combobox', { name: 'Colour book' }));
    // Newest first — the first option is flagged as the latest/default.
    await user.click(await screen.findByText('Pantone 2026 (latest)'));

    await vi.waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch?.[0]).toBe(`/api/admin/purchase-orders/${PO_ID}`);
      expect(JSON.parse(patch![1]!.body as string)).toEqual({ colorBookId: 'cb-new' });
    });
    expect(await screen.findByText('Colour book updated')).toBeInTheDocument();
  });

  it('renders the production files card with its files', async () => {
    const { addRoute } = installMockFetch(baseRoutes());
    // Registered after baseRoutes' empty files route, so it wins.
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/files`,
      method: 'GET',
      response: {
        items: [
          {
            id: 'file-1',
            fileName: 'layout-v1.pdf',
            contentType: 'application/pdf',
            sizeBytes: 1000,
            category: 'Test print',
            uploadedByKind: 'staff',
            uploadedByLabel: 'dana@example.com',
            statusAtUpload: 'test_print',
            createdAt: '2026-07-19T10:00:00Z',
            downloadUrl: 'https://signed.example.com/layout-v1.pdf',
            comments: [],
          },
        ],
      },
    });
    renderView();

    expect(await screen.findByText('Production files')).toBeInTheDocument();
    expect(await screen.findByText('layout-v1.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download all as zip/i }).closest('a')).toHaveAttribute(
      'href',
      `/api/admin/purchase-orders/${PO_ID}/files.zip`,
    );
  });
});
